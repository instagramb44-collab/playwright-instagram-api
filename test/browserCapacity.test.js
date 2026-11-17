const test = require("node:test");
const assert = require("node:assert/strict");
const { acquireBrowserSlot, getBrowserCapacityStatus } = require("../services/browserCapacity");

test("keeps one shared Chromium slot and releases it safely", () => {
  assert.deepEqual(getBrowserCapacityStatus(), { active: 0, maximum: 1 });
  const release = acquireBrowserSlot("test-login");
  assert.deepEqual(getBrowserCapacityStatus(), { active: 1, maximum: 1 });

  assert.throws(
    () => acquireBrowserSlot("second-user"),
    error => error.status === 429 && error.code === "INSTAGRAM_BROWSER_CAPACITY"
  );

  release();
  release();
  assert.deepEqual(getBrowserCapacityStatus(), { active: 0, maximum: 1 });
});
