const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const { saveStorageState } = require("./instagramConnectionStore");

const SESSION_TTL_MS = 10 * 60 * 1000;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_ACTIVE_SESSIONS = 1;
const sessions = new Map();

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
  // A user may have only one active interactive login session at a time.
  for (const [id, session] of sessions) {
    if (session.userId === userId) await closeSession(id);
  }

  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    const error = new Error("All interactive browser slots are currently in use. Please try again shortly.");
    error.status = 429;
    throw error;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  try {
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
          return route.abort();
        }
      }
      return route.continue();
    });

    const page = await context.newPage();
    const sessionId = randomUUID();

    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    sessions.set(sessionId, {
      userId,
      browser,
      context,
      page,
      createdAt: Date.now()
    });

    return { sessionId, expiresInSeconds: SESSION_TTL_MS / 1000 };
  } catch (error) {
    await browser.close();
    throw error;
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
