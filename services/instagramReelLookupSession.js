const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { WebSocketServer } = require("ws");
const { loadStorageState } = require("./instagramConnectionStore");
const { extractCreator } = require("./instagramReelLookup");
const { acquireBrowserSlot } = require("./browserCapacity");

const SESSION_TTL_MS = 90_000;
const TOKEN_TTL_MS = 30_000;
const LOOKUP_TIMEOUT_MS = 75_000;
const sessions = new Map();
const activeByUser = new Map();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function safeEqual(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function createLookupSession(userId, reelUrl, shortcode) {
  if (activeByUser.has(userId)) {
    const error = new Error("A Reel lookup is already active for this account.");
    error.status = 409;
    error.code = "REEL_LOOKUP_ALREADY_ACTIVE";
    throw error;
  }
  const sessionId = crypto.randomUUID();
  const viewerToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  sessions.set(sessionId, {
    sessionId, userId, reelUrl, shortcode,
    tokenHash: hashToken(viewerToken),
    tokenExpiresAt: now + TOKEN_TTL_MS,
    expiresAt: now + SESSION_TTL_MS,
    consumed: false,
    socket: null,
    browser: null,
    timer: null,
    releaseSlot: null,
    closed: false
  });
  activeByUser.set(userId, sessionId);
  return { sessionId, viewerToken, expiresInSeconds: SESSION_TTL_MS / 1000 };
}
function getOwnedSession(sessionId, userId) {
  const session = sessions.get(sessionId);
  return session && session.userId === userId ? session : null;
}
async function closeLookupSession(sessionId, code = 1000, reason = "Lookup closed") {
  const session = sessions.get(sessionId);
  if (!session || session.closed) return false;
  session.closed = true;
  sessions.delete(sessionId);
  if (activeByUser.get(session.userId) === sessionId) activeByUser.delete(session.userId);
  if (session.timer) clearTimeout(session.timer);
  if (session.socket && session.socket.readyState === 1) {
    try { session.socket.close(code, reason.slice(0, 100)); } catch {}
  }
  if (session.browser) await session.browser.close().catch(() => {});
  if (session.releaseSlot) session.releaseSlot();
  return true;
}
function sendJson(socket, payload) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}
function attachReelLookupWebSocket(server, allowedOrigins) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, "http://localhost").pathname; } catch { socket.destroy(); return; }
    const match = pathname.match(/^\/ws\/instagram\/reel\/lookup\/([0-9a-f-]{36})$/i);
    if (!match) { socket.destroy(); return; }
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit("connection", ws, request, match[1]);
    });
  });

  wss.on("connection", (socket, request, sessionId) => {
    const session = sessions.get(sessionId);
    if (!session || session.closed || Date.now() > session.expiresAt) {
      sendJson(socket, { type: "error", status: 404, message: "Reel lookup session expired." });
      socket.close(4404, "Session expired");
      return;
    }
    session.socket = socket;
    let authenticated = false;
    let finished = false;
    const finish = async (code, reason) => {
      if (finished) return;
      finished = true;
      await closeLookupSession(sessionId, code, reason);
    };

    const authTimeout = setTimeout(() => {
      if (!authenticated) finish(4401, "Authentication timeout");
    }, 8000);
    authTimeout.unref();

    socket.on("message", async (raw, isBinary) => {
      if (authenticated || isBinary) return finish(4401, "Unexpected message");
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return finish(4401, "Invalid authentication"); }
      if (message?.type !== "auth" || typeof message.viewerToken !== "string" ||
          Date.now() > session.tokenExpiresAt ||
          !safeEqual(hashToken(message.viewerToken), session.tokenHash)) {
        sendJson(socket, { type: "error", status: 401, message: "Invalid or expired viewer token." });
        return finish(4401, "Unauthorized");
      }
      authenticated = true;
      clearTimeout(authTimeout);
      session.consumed = true;
      session.tokenHash = null;
      try {
        session.releaseSlot = acquireBrowserSlot("reel-lookup");
        const storageState = await loadStorageState(session.userId);
        if (!storageState) {
          sendJson(socket, { type: "error", status: 409, message: "Connect your Instagram account before looking up Reel creators." });
          return finish(4409, "Instagram not connected");
        }
        sendJson(socket, { type: "status", step: "starting_browser", message: "Starting secure Instagram browser..." });
        session.browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
        const context = await session.browser.newContext({ storageState, viewport: { width: 1280, height: 800 }, locale: "en-US" });
        await context.route("**/*", route => {
          if (route.request().isNavigationRequest() && route.request().frame().parentFrame() === null) {
            let host = "";
            try { host = new URL(route.request().url()).hostname.toLowerCase(); } catch {}
            if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        sendJson(socket, { type: "status", step: "loading_session", message: "Loading your saved Instagram connection..." });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Page.enable");
        await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 1100, maxHeight: 720, everyNthFrame: 2 });
        cdp.on("Page.screencastFrame", async event => {
          try {
            if (socket.readyState === 1) sendJson(socket, { type: "frame", data: event.data, mimeType: "image/jpeg" });
            await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
          } catch {}
        });
        sendJson(socket, { type: "status", step: "navigating", message: "Opening the Instagram Reel..." });
        const response = await page.goto(session.reelUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        if (response?.status() === 429) {
          const error = new Error("Instagram is temporarily rate-limiting this request."); error.status = 429; throw error;
        }
        const current = new URL(page.url());
        if (!["instagram.com", "www.instagram.com"].includes(current.hostname) ||
            /^\/accounts\/(login|challenge)/.test(current.pathname)) {
          const error = new Error("Your Instagram connection needs attention. Reconnect and try again."); error.status = 409; throw error;
        }
        sendJson(socket, { type: "status", step: "extracting", message: "Finding the Reel creator..." });
        let creator = null;
        for (let attempt = 0; attempt < 8 && !creator; attempt++) {
          creator = await extractCreator(page).catch(() => null);
          if (!creator) await page.waitForTimeout(700);
        }
        if (!creator) { const error = new Error("Instagram did not provide creator details for this Reel."); error.status = 422; throw error; }
        sendJson(socket, { type: "result", reelUrl: session.reelUrl, shortcode: session.shortcode, creator });
        await finish(1000, "Lookup completed");
      } catch (error) {
        sendJson(socket, { type: "error", status: error.status || 502, message: error.status ? error.message : "Unable to complete the Instagram Reel lookup." });
        await finish(1011, "Lookup failed");
      }
    });
    socket.on("close", () => finish(1000, "Viewer disconnected"));
    socket.on("error", () => finish(1011, "WebSocket error"));
    session.timer = setTimeout(() => finish(4408, "Lookup timed out"), LOOKUP_TIMEOUT_MS);
    session.timer.unref();
  });
  return wss;
}
const sweep = setInterval(() => {
  for (const [id, session] of sessions) {
    if (Date.now() > session.expiresAt || (session.consumed && !session.socket)) closeLookupSession(id, 4408, "Session expired");
  }
}, 5000);
sweep.unref();

module.exports = { createLookupSession, getOwnedSession, closeLookupSession, attachReelLookupWebSocket };
