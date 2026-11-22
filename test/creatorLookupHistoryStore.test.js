const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PLATFORM_SUPABASE_URL = "https://platform-project.supabase.co";
process.env.PLATFORM_SUPABASE_SECRET_KEY = "platform-server-secret-test";

const store = require("../services/creatorLookupHistoryStore");
const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

test("saves result rows with the verified user and batch ID", async () => {
  let call;
  global.fetch = async (url, options) => {
    call = { url: String(url), options };
    return new Response(null, { status: 204 });
  };
  await store.saveCreatorLookupHistory("verified-user-1", [{
    reelUrl: "https://www.instagram.com/reel/abc123/",
    shortcode: "abc123",
    username: "creator",
    profileName: "Creator Name",
    profileUrl: "https://www.instagram.com/creator/"
  }], "batch-1");
  assert.match(call.url, /creator_lookup_history$/);
  assert.equal(call.options.method, "POST");
  const rows = JSON.parse(call.options.body);
  assert.equal(rows[0].user_id, "verified-user-1");
  assert.equal(rows[0].batch_id, "batch-1");
  assert.equal(rows[0].creator_username, "creator");
  assert.equal(rows[0].error, null);
  assert.equal(call.options.headers.apikey, "platform-server-secret-test");
});

test("stores failed lookups too, with null creator fields", async () => {
  let savedRows;
  global.fetch = async (_url, options) => {
    savedRows = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  };
  await store.saveCreatorLookupHistory("verified-user-2", [{
    reelUrl: "https://www.instagram.com/reel/failed/",
    shortcode: "failed",
    username: null,
    profileName: null,
    profileUrl: null,
    error: "Unable to find creator. Please try again."
  }], "batch-2");
  assert.equal(savedRows[0].creator_username, null);
  assert.equal(savedRows[0].error, "Unable to find creator. Please try again.");
});

test("loads only the verified user's rows and caps the requested limit", async () => {
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([]), { status: 200 });
  };
  await store.fetchCreatorLookupHistory("verified-user-3", 999);
  assert.match(requestedUrl, /user_id=eq\.verified-user-3/);
  assert.match(requestedUrl, /limit=200/);
  assert.match(requestedUrl, /order=created_at\.desc/);
});

test("rejects missing user IDs before database access", async () => {
  await assert.rejects(store.fetchCreatorLookupHistory("", 20), /Verified Platform user ID/);
  await assert.rejects(store.saveCreatorLookupHistory("", [], "batch"), /Verified Platform user ID/);
});
