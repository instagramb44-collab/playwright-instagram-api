const { chromium } = require("playwright");
const { loadStorageState } = require("./instagramConnectionStore");
const { acquireBrowserSlot } = require("./browserCapacity");

const NAVIGATION_TIMEOUT_MS = 45000;

function extractUsernameFromDescription(description) {
  if (typeof description !== "string") return null;
  const match = description.match(/\s-\s([A-Za-z0-9._]{1,30})\s+on\s/i);
  return match ? match[1] : null;
}

async function extractCreator(page) {
  const username = await page.evaluate(() => {
    const isUsername = value =>
      typeof value === "string" &&
      /^[A-Za-z0-9._]{1,30}$/.test(value);

    const visited = new Set();
    const findOwner = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 18 || visited.has(value)) return null;
      visited.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findOwner(item, depth + 1);
          if (found) return found;
        }
        return null;
      }

      const mediaKeys = ["shortcode_media", "xdt_shortcode_media", "graphql"];
      for (const key of mediaKeys) {
        const media = value[key];
        if (media && typeof media === "object") {
          const owner = media.owner || media.user;
          if (owner && isUsername(owner.username)) return owner.username;
          const nested = findOwner(media, depth + 1);
          if (nested) return nested;
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if ((key === "owner" || key === "user") &&
            child && isUsername(child.username)) return child.username;
        if (child && typeof child === "object") {
          const found = findOwner(child, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };

    const sources = [];
    if (window._sharedData) sources.push(window._sharedData);
    for (const script of document.querySelectorAll("script")) {
      const text = script.textContent || "";
      if (!text || text.length > 5_000_000) continue;
      const start = text.indexOf("{");
      if (start < 0) continue;
      try { sources.push(JSON.parse(text.slice(start))); } catch {}
    }
    for (const source of sources) {
      const found = findOwner(source);
      if (found) return found;
    }

    const description = document.querySelector('meta[property="og:description"]')
      ?.getAttribute("content") || "";
    const match = description.match(/\s-\s([A-Za-z0-9._]{1,30})\s+on\s/i);
    return match ? match[1] : null;
  });

  if (!username || !/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  return { username, profileUrl: `https://www.instagram.com/${username}/` };
}

async function lookupReelCreator(userId, reelUrl) {
  const storageState = await loadStorageState(userId);
  if (!storageState) {
    const error = new Error("Connect your Instagram account before looking up Reel creators.");
    error.status = 409;
    error.code = "INSTAGRAM_NOT_CONNECTED";
    throw error;
  }

  let browser;
  let releaseSlot;
  try {
    releaseSlot = acquireBrowserSlot("synchronous-reel-lookup");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 800 },
      locale: "en-US"
    });
    const page = await context.newPage();
    const response = await page.goto(reelUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS
    });

    const status = response?.status();
    if (status === 429) {
      const error = new Error("Instagram is temporarily rate-limiting this request. Please try again later.");
      error.status = 429;
      error.code = "INSTAGRAM_RATE_LIMITED";
      throw error;
    }
    if (status && status >= 500) {
      const error = new Error("Instagram is temporarily unavailable. Please try again later.");
      error.status = 503;
      error.code = "INSTAGRAM_UNAVAILABLE";
      throw error;
    }

    const currentUrl = new URL(page.url());
    if (currentUrl.hostname !== "www.instagram.com" &&
        currentUrl.hostname !== "instagram.com") {
      const error = new Error("Instagram redirected the request to an unexpected page.");
      error.status = 502;
      error.code = "INSTAGRAM_UNEXPECTED_REDIRECT";
      throw error;
    }
    if (/^\/accounts\/(login|challenge)/.test(currentUrl.pathname)) {
      const error = new Error("Your Instagram connection needs attention. Reconnect your account and try again.");
      error.status = 409;
      error.code = "INSTAGRAM_REAUTH_REQUIRED";
      throw error;
    }

    const creator = await extractCreator(page);
    if (!creator) {
      const error = new Error("Instagram did not provide creator details for this Reel. It may be private, unavailable, or temporarily blocked.");
      error.status = 422;
      error.code = "REEL_CREATOR_NOT_FOUND";
      throw error;
    }
    return creator;
  } catch (error) {
    if (error.status) throw error;
    if (error.name === "TimeoutError") {
      const timeout = new Error("Instagram took too long to load this Reel. Please try again.");
      timeout.status = 504;
      timeout.code = "INSTAGRAM_TIMEOUT";
      throw timeout;
    }
    const unavailable = new Error("Unable to load this Reel from Instagram right now.");
    unavailable.status = 502;
    unavailable.code = "INSTAGRAM_LOOKUP_FAILED";
    throw unavailable;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (releaseSlot) releaseSlot();
  }
}

module.exports = { lookupReelCreator, extractCreator, extractUsernameFromDescription };
