const test = require("node:test");
const assert = require("node:assert/strict");

const {
  lookupReelCreator,
  extractCreator,
  extractUsernameFromDescription
} = require("../services/instagramReelLookup");

test("exports the creator extractor used by the live lookup session", () => {
  assert.equal(typeof lookupReelCreator, "function");
  assert.equal(typeof extractCreator, "function");
});

test("extracts the username from Instagram Open Graph Reel descriptions", () => {
  assert.equal(
    extractUsernameFromDescription("1,234 likes, 56 comments - creator.name on Instagram:"),
    "creator.name"
  );
  assert.equal(
    extractUsernameFromDescription("Some text - user_123 on Instagram"),
    "user_123"
  );
});

test("does not extract a username when the Instagram description has no creator separator", () => {
  assert.equal(extractUsernameFromDescription("Instagram Reel"), null);
  assert.equal(extractUsernameFromDescription(null), null);
});
