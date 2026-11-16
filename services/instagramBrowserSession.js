const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { saveStorageState } = require("./instagramConnectionStore");

const SESSION_TTL_MS = 10 * 60 * 1000;
const VIEWPORT = { width: 1280, height: 800 };

// Each user gets one interactive login session. Keep a small process-wide
// ceiling because Chromium is memory-intensive on the Render Free instance.
const DEFAULT_MAX_ACTIVE_SESSIONS = 2;
const configuredMax = Number.parseInt(process.env.MAX_ACTIVE_INSTAGRAM_SESSIONS || "", 10);
const MAX_ACTIVE_SESSIONS =
  Number.isInteger(configuredMax) && configuredMax >= 2 && configuredMax <= 4
    ? configuredMax
    : DEFAULT_MAX_ACTIVE_SESSIONS;

const sessions = new Map();
const pendingStarts = new Map();
let startLock = Promise.resolve();

function withStartLock(operation) {
  const previous = startLock;
  let release;
  startLock = new Promise(resolve => { release = resolve; });
  return previous.then(operation).finally(release);
}

const expirySweep = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      closeSession(id).catch(() => {});
    }
  }
}, 60 * 1000);
expirySweep.unref();

function getOwnedSession(sessionId, userId) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    closeSession(sessionId).catch(() => {});
    return null;
  }
  return session;
}

async function startLoginSession(userId) {
  if (!userId) {
    const error = new Error("A verified user is required to start an Instagram login session.");
    error.status = 401;
    throw error;
  }

  const reservation = Symbol("instagram-session-start");
  await withStartLock(async () => {
    // A user may replace their own existing interactive login session.
    for (const [id, session] of sessions) {
      if (session.userId === userId) await closeSession(id);
    }

    if (pendingStarts.has(userId)) {
      const error = new Error("An Instagram login session is already starting for this account.");
      error.status = 409;
      throw error;
    }

    if (sessions.size + pendingStarts.size >= MAX_ACTIVE_SESSIONS) {
      const error = new Error("All interactive browser slots are currently in use. Please try again shortly.");
      error.status = 429;
      error.code = "INSTAGRAM_BROWSER_CAPACITY";
      error.retryAfterSeconds = 30;
      throw error;
    }

    // Reserve capacity before launching Chromium so simultaneous requests
    // cannot race past the process-wide limit.
    pendingStarts.set(userId, reservation);
  });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: "en-US"
    });
    // Restrict top-level navigation to Instagram so this is not a general
    // remote browser. Subresources remain available for the login page.
    await context.route("**/*", async route => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
        const hostname = new URL(request.url()).hostname.toLowerCase();
        if (hostname !== "instagram.com" && !hostname.endsWith(".instagram.com")) {
          // Log only the hostname and resource type; never log full URLs or query strings.
          console.warn("[Instagram browser] blocked top-level redirect", {
            hostname,
            resourceType: request.resourceType()
          });
          return route.abort();
        }
      }
      return route.continue();
    });

    const page = await context.newPage();
    const sessionId = randomUUID();
    let mainDocumentStatus = null;

    page.on("response", response => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        mainDocumentStatus = response.status();
        let hostname = "unknown";
        try { hostname = new URL(response.url()).hostname; } catch {}
        console.info("[Instagram browser] main document response", {
          hostname,
          status: mainDocumentStatus
        });
      }
    });
    page.on("requestfailed", request => {
      let hostname = "unknown";
      try { hostname = new URL(request.url()).hostname; } catch {}
      console.warn("[Instagram browser] request failed", {
        hostname,
        resourceType: request.resourceType()
      });
    });
    page.on("pageerror", error => {
      console.warn("[Instagram browser] page script error", {
        name: error?.name || "Error"
      });
    });

    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    // Keep the short-lived browser session available even when the expected
    // username input is not detected. The user can inspect the actual page
    // through the existing remote frame, and diagnostics help identify layout
    // or interstitial changes without logging page content or credentials.
    let loginPageReady = true;
    if (!await page.locator('input[name="username"]').isVisible().catch(() => false)) {
      try {
        await page.locator('input[name="username"]').waitFor({
          state: "visible",
          timeout: 15000
        });
      } catch {
        loginPageReady = false;
        let finalHostname = "unknown";
        let pageTitle = "unavailable";
        try { finalHostname = new URL(page.url()).hostname; } catch {}
        try { pageTitle = (await page.title()).slice(0, 100); } catch {}
        console.warn("[Instagram browser] login form not detected; keeping diagnostic session", {
          finalHostname,
          pageTitle,
          mainDocumentStatus
        });
      }
    }

    sessions.set(sessionId, {
      userId,
      browser,
      context,
      page,
      createdAt: Date.now()
    });

    return {
      sessionId,
      expiresInSeconds: SESSION_TTL_MS / 1000,
      loginPageReady
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    throw error;
  } finally {
    await withStartLock(async () => {
      if (pendingStarts.get(userId) === reservation) pendingStarts.delete(userId);
    });
  }
}

async function getFrame(sessionId, userId) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) return null;
  if (session.page.isClosed()) {
    await closeSession(sessionId);
    return null;
  }
  return session.page.screenshot({ type: "jpeg", quality: 65 });
}

async function sendInput(sessionId, userId, input) {
  const session = getOwnedSession(sessionId, userId);
  if (!session || session.page.isClosed()) return false;

  const { action } = input || {};
  if (action === "click") {
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) {
      const error = new Error("Click coordinates are outside the browser viewport.");
      error.status = 400;
      throw error;
    }
    await session.page.mouse.click(x, y);
    return true;
  }

  if (action === "type") {
    if (typeof input.text !== "string" || input.text.length > 500) {
      const error = new Error("Text input must be a string of at most 500 characters.");
      error.status = 400;
      throw error;
    }
    // Never log typed text: it may contain an Instagram password.
    await session.page.keyboard.type(input.text);
    return true;
  }

  if (action === "press") {
    const allowedKeys = new Set([
      "Enter", "Tab", "Backspace", "Delete", "Escape",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Home", "End", " "
    ]);
    if (!allowedKeys.has(input.key)) {
      const error = new Error("That keyboard key is not supported.");
      error.status = 400;
      throw error;
    }
    await session.page.keyboard.press(input.key);
    return true;
  }

  if (action === "scroll") {
    const deltaY = Number(input.deltaY);
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 1200) {
      const error = new Error("Scroll amount must be between -1200 and 1200.");
      error.status = 400;
      throw error;
    }
    await session.page.mouse.wheel(0, deltaY);
    return true;
  }

  const error = new Error("Unsupported browser input action.");
  error.status = 400;
  throw error;
}

async function completeLoginSession(sessionId, userId) {
  const session = getOwnedSession(sessionId, userId);
  if (!session || session.page.isClosed()) return false;

  const cookies = await session.context.cookies("https://www.instagram.com");
  const hasSessionCookie = cookies.some(cookie => cookie.name === "sessionid" && cookie.value);
  if (!hasSessionCookie) return false;

  const storageState = await session.context.storageState();
  await saveStorageState(userId, storageState);
  await closeSession(sessionId);
  return true;
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.browser.close();
}

async function closeOwnedSession(sessionId, userId) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) return false;
  await closeSession(sessionId);
  return true;
}

async function closeUserSessions(userId) {
  const ownedIds = [...sessions.entries()]
    .filter(([, session]) => session.userId === userId)
    .map(([id]) => id);
  await Promise.all(ownedIds.map(id => closeSession(id)));
}

module.exports = {
  startLoginSession,
  getFrame,
  sendInput,
  completeLoginSession,
  closeUserSessions,
  closeOwnedSession,
  closeSession
};
