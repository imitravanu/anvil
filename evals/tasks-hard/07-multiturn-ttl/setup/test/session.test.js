const test = require("node:test");
const assert = require("node:assert");
const { createSession } = require("../src/session.js");

test("a numeric ttl keeps meaning seconds", () => {
  assert.strictEqual(createSession({ ttl: 3600 }).ttlMs, 3_600_000);
  assert.strictEqual(createSession({}).ttlMs, 60_000);
});

test("a duration string is accepted too", () => {
  assert.strictEqual(createSession({ ttl: "30m" }).ttlMs, 1_800_000);
  assert.strictEqual(createSession({ ttl: "1h30m" }).ttlMs, 5_400_000);
});
