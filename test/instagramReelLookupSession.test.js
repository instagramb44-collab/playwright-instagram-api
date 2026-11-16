const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLookupSession,
  getOwnedSession,
  closeLookupSession
} = require("../services/instagramReelLookupSession");

test("creates a short-lived lookup session with the frontend response contract", async () => {
  const userId = "lookup-contract-user";
  const session = createLookupSession(
    userId,
    "https://www.instagram.com/reel/AbCdEf123/",
    "AbCdEf123"
  );

  assert.equal(typeof session.sessionId, "string");
  assert.ok(session.sessionId.length > 0);
  assert.equal(typeof session.viewerToken, "string");
  assert.ok(session.viewerToken.length > 20);
  assert.equal(session.expiresInSeconds, 90);

  const stored = getOwnedSession(session.sessionId, userId);
  assert.ok(stored);
  assert.equal(Object.hasOwn(session, "tokenHash"), false);
  assert.equal(Object.hasOwn(stored, "viewerToken"), false);

  await closeLookupSession(session.sessionId);
});

test("lookup sessions are isolated by Supabase user ID", async () => {
  const session = createLookupSession(
    "lookup-owner-user",
    "https://www.instagram.com/reel/Owner123/",
    "Owner123"
  );

  assert.equal(getOwnedSession(session.sessionId, "different-user"), null);
  assert.equal(getOwnedSession(session.sessionId, "lookup-owner-user").userId, "lookup-owner-user");

  await closeLookupSession(session.sessionId);
});

test("allows only one pending lookup session per user", async () => {
  const first = createLookupSession(
    "one-lookup-user",
    "https://www.instagram.com/reel/First123/",
    "First123"
  );

  assert.throws(
    () => createLookupSession(
      "one-lookup-user",
      "https://www.instagram.com/reel/Second123/",
      "Second123"
    ),
    error => error.status === 409 && error.code === "REEL_LOOKUP_ALREADY_ACTIVE"
  );

  await closeLookupSession(first.sessionId);
});

test("different users can create separate lookup sessions", async () => {
  const first = createLookupSession(
    "parallel-lookup-user-a",
    "https://www.instagram.com/reel/First456/",
    "First456"
  );
  const second = createLookupSession(
    "parallel-lookup-user-b",
    "https://www.instagram.com/reel/Second456/",
    "Second456"
  );

  assert.notEqual(first.sessionId, second.sessionId);
  assert.ok(getOwnedSession(first.sessionId, "parallel-lookup-user-a"));
  assert.ok(getOwnedSession(second.sessionId, "parallel-lookup-user-b"));

  await closeLookupSession(first.sessionId);
  await closeLookupSession(second.sessionId);
});

test("lookup session cleanup is idempotent", async () => {
  const session = createLookupSession(
    "cleanup-lookup-user",
    "https://www.instagram.com/reel/Cleanup123/",
    "Cleanup123"
  );

  assert.equal(await closeLookupSession(session.sessionId), true);
  assert.equal(await closeLookupSession(session.sessionId), false);
  assert.equal(getOwnedSession(session.sessionId, "cleanup-lookup-user"), null);
});
