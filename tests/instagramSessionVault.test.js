const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.INSTAGRAM_SESSION_ENCRYPTION_KEY =
  crypto.randomBytes(32).toString("base64");

const { encryptStorageState, decryptStorageState } =
  require("../lib/instagramSessionVault");

test("encrypts and decrypts Playwright storage state", () => {
  const state = {
    cookies: [{ name: "sessionid", value: "test-only", domain: ".instagram.com" }],
    origins: []
  };

  const encrypted = encryptStorageState(state);
  assert.notEqual(encrypted.encrypted_storage_state, JSON.stringify(state));
  assert.deepEqual(decryptStorageState(encrypted), state);
});

test("uses a fresh IV for each encryption", () => {
  const state = { cookies: [], origins: [] };
  const first = encryptStorageState(state);
  const second = encryptStorageState(state);
  assert.notEqual(first.encryption_iv, second.encryption_iv);
});

test("rejects modified ciphertext", () => {
  const encrypted = encryptStorageState({ cookies: [], origins: [] });
  const modified = {
    ...encrypted,
    encrypted_storage_state: Buffer.from("tampered").toString("base64")
  };
  assert.throws(() => decryptStorageState(modified));
});
