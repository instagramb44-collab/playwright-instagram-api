const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.APP_SUPABASE_URL = "https://app-project.supabase.co";
process.env.APP_SUPABASE_SECRET_KEY = "sb_secret_app_test";
process.env.SESSION_SUPABASE_URL = "https://sessions-project.supabase.co";
process.env.SESSION_SUPABASE_SECRET_KEY = "sb_secret_sessions_test";
process.env.INSTAGRAM_SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const calls = [];
const originalFetch = global.fetch;

test.beforeEach(() => { calls.length = 0; });
test.after(() => { global.fetch = originalFetch; });

function mockFetch(handler) {
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
}

test("Creator Lookup History uses only the application Supabase project", async () => {
  mockFetch(async () => new Response("[]", { status: 200 }));
  const { getCreatorLookupHistory } = require("../services/creatorLookupHistoryStore");
  await getCreatorLookupHistory("platform-user-id", 20);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://app-project.supabase.co/rest/v1/"));
  assert.match(calls[0].url, /user_id=eq.platform-user-id/);
  assert.equal(calls[0].options.headers.apikey, "sb_secret_app_test");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("Instagram connection storage uses only the sessions project and app_user_id", async () => {
  mockFetch(async (url, options) => {
    if (options.method === "POST") return new Response(null, { status: 204 });
    return new Response("[]", { status: 200 });
  });
  const { saveStorageState } = require("../services/instagramConnectionStore");
  await saveStorageState("platform-user-id", { cookies: [], origins: [] });

  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.startsWith("https://sessions-project.supabase.co/rest/v1/")));
  assert.match(calls[0].url, /app_user_id=eq.platform-user-id/);
  assert.equal(calls[1].options.headers.apikey, "sb_secret_sessions_test");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.app_user_id, "platform-user-id");
  assert.equal(payload.user_id, undefined);
  assert.ok(payload.encrypted_storage_state);
  assert.notEqual(payload.encrypted_storage_state, JSON.stringify({ cookies: [], origins: [] }));
});
