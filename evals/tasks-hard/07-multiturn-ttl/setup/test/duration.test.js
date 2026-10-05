const test = require("node:test");
const assert = require("node:assert");
const { parseDuration } = require("../src/duration.js");

test("parses the documented forms", () => {
  assert.strictEqual(parseDuration("45s"), 45_000);
  assert.strictEqual(parseDuration("2m"), 120_000);
  assert.strictEqual(parseDuration("1h30m"), 5_400_000);
});

test("throws on anything it cannot parse", () => {
  assert.throws(() => parseDuration("abc"));
  assert.throws(() => parseDuration(""));
});
