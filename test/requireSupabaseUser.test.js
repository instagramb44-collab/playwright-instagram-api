const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PLATFORM_SUPABASE_URL = "https://platform-project.supabase.co";
process.env.PLATFORM_SUPABASE_PUBLISHABLE_KEY = "platform-publishable-test-key";

const { requireSupabaseUser } = require("../middleware/requireSupabaseUser");
const originalFetch = global.fetch;

test.afterEach(() => { global.fetch = originalFetch; });

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("verifies bearer token against Platform Supabase and uses returned user ID", async () => {
  let requestedUrl = "";
  let requestedHeaders = null;
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedHeaders = options.headers;
    return new Response(JSON.stringify({ id: "verified-platform-user", email: "user@example.test" }), { status: 200 });
  };
  const req = { get: name => name.toLowerCase() === "authorization" ? "Bearer valid-platform-token" : "" };
  const res = responseRecorder();
  let nextCalled = false;
  await requireSupabaseUser(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, "verified-platform-user");
  assert.equal(req.user.email, "user@example.test");
  assert.equal(requestedUrl, "https://platform-project.supabase.co/auth/v1/user");
  assert.equal(requestedHeaders.apikey, "platform-publishable-test-key");
  assert.equal(requestedHeaders.Authorization, "Bearer valid-platform-token");
});

test("rejects requests without a bearer token", async () => {
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; throw new Error("must not fetch"); };
  const req = { get: () => "" };
  const res = responseRecorder();
  await requireSupabaseUser(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
  assert.equal(fetchCalled, false);
});

test("rejects a token rejected by Platform Supabase Auth", async () => {
  global.fetch = async () => new Response("{}", { status: 401 });
  const req = { get: () => "Bearer invalid-token" };
  const res = responseRecorder();
  await requireSupabaseUser(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
});
