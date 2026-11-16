const test = require("node:test");
const assert = require("node:assert/strict");

const { lookupReelCreator, extractCreator } = require("../services/instagramReelLookup");

test("exports the creator extractor used by the live lookup session", () => {
  assert.equal(typeof lookupReelCreator, "function");
  assert.equal(typeof extractCreator, "function");
});
