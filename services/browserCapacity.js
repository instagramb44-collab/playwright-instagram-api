const DEFAULT_MAX_ACTIVE_BROWSERS = 1;
const configuredMax = Number.parseInt(process.env.MAX_ACTIVE_BROWSER_INSTANCES || "", 10);
const MAX_ACTIVE_BROWSERS =
  Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 4
    ? configuredMax
    : DEFAULT_MAX_ACTIVE_BROWSERS;

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
