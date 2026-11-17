// Render Free currently runs one Chromium browser reliably. Keep this hard cap
// centralized so an environment variable cannot accidentally overcommit RAM.
const MAX_ACTIVE_BROWSERS = 1;

const active = new Map();

function acquireBrowserSlot(owner) {
  if (active.size >= MAX_ACTIVE_BROWSERS) {
    const error = new Error("All interactive browser slots are currently in use. Please try again shortly.");
    error.status = 429;
    error.code = "INSTAGRAM_BROWSER_CAPACITY";
    error.retryAfterSeconds = 30;
    throw error;
  }

  const key = Symbol(String(owner || "instagram-browser"));
  active.set(key, owner || "instagram-browser");
  let released = false;

  return function releaseBrowserSlot() {
    if (released) return;
    released = true;
    active.delete(key);
  };
}

function getBrowserCapacityStatus() {
  return { active: active.size, maximum: MAX_ACTIVE_BROWSERS };
}

module.exports = { acquireBrowserSlot, getBrowserCapacityStatus };
