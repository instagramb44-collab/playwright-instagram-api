const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.SESSIONS_SUPABASE_URL = "https://sessions-project.supabase.co";
process.env.SESSIONS_SUPABASE_SECRET_KEY = "sessions-secret-test-key";
process.env.INSTAGRAM_SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const store = require("../services/instagramConnectionStore");
const originalFetch = global.fetch;

test.afterEach(() => { global.fetch = originalFetch; });

test("reads connection status by Platform app_user_id, never legacy user_id", async () => {
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ status: "connected", connected_at: "2026-01-01T00:00:00Z" }]), { status: 200 });
  };
  const result = await store.getConnectionStatus("platform-user-123");
  assert.equal(result.status, "connected");
  assert.match(requestedUrl, /app_user_id=eq\.platform-user-123/);
  assert.doesNotMatch(requestedUrl, /[?&]user_id=/);
  assert.match(requestedUrl, /^https:\/\/sessions-project\.supabase\.co\/rest\/v1\//);
});

test("inserts encrypted state with Platform app_user_id and null legacy user_id", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response("[]", { status: 200 });
    return new Response(null, { status: 204 });
  };
  await store.saveStorageState("platform-user-456", { cookies: [{ name: "sessionid", value: "test-only" }], origins: [] });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /app_user_id=eq\.platform-user-456/);
  assert.equal(calls[1].options.method, "POST");
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.app_user_id, "platform-user-456");
  assert.equal(payload.user_id, null);
  assert.ok(payload.encrypted_storage_state);
  assert.ok(payload.encryption_iv);
  assert.ok(payload.encryption_auth_tag);
  assert.doesNotMatch(calls[1].options.body, /test-only/);
});

test("updates only the matching Platform app_user_id row", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response(JSON.stringify([{ id: "row-1" }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  await store.saveStorageState("platform-user-789", { cookies: [], origins: [] });
  assert.equal(calls[1].options.method, "PATCH");
  assert.match(calls[1].url, /app_user_id=eq\.platform-user-789/);
  assert.doesNotMatch(calls[1].url, /[?&]user_id=/);
});

test("loads and decrypts only the matching Platform user session", async () => {
  const state = { cookies: [{ name: "sessionid", value: "test-session-value" }], origins: [] };
  const { encryptStorageState } = require("../lib/instagramSessionVault");
  const encrypted = encryptStorageState(state);
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ ...encrypted, status: "connected" }]), { status: 200 });
  };
  assert.deepEqual(await store.loadStorageState("platform-user-abc"), state);
  assert.match(requestedUrl, /app_user_id=eq\.platform-user-abc/);
  assert.doesNotMatch(requestedUrl, /[?&]user_id=/);
});

test("disconnect deletes only the matching Platform app_user_id row", async () => {
  let requestedUrl = "";
  let method = "";
  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    method = options.method;
    return new Response(null, { status: 204 });
  };
  await store.disconnect("platform-user-delete");
  assert.equal(method, "DELETE");
  assert.match(requestedUrl, /app_user_id=eq\.platform-user-delete/);
  assert.doesNotMatch(requestedUrl, /[?&]user_id=/);
});

test("rejects missing user IDs before accessing session storage", async () => {
  await assert.rejects(store.getConnectionStatus(""), /verified Platform user ID/);
  await assert.rejects(store.loadStorageState(null), /verified Platform user ID/);
  await assert.rejects(store.disconnect(""), /verified Platform user ID/);
});
