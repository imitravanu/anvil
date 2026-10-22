const test = require("node:test");
const assert = require("node:assert");
const { allocate } = require("../src/allocate.js");

// The visible suite only covers a split that happens to divide evenly, so it is
// green before and after the fix and says nothing about the reported bug.
test("splits an even total across equal weights", () => {
  assert.deepStrictEqual(allocate(100, [1, 1]), [50, 50]);
});

test("gives the whole total to a single line", () => {
  assert.deepStrictEqual(allocate(250, [1]), [250]);
});
