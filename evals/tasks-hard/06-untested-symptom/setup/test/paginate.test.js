const test = require("node:test");
const assert = require("node:assert");
const { paginate } = require("../src/paginate.js");

// NOTE: this suite is green with the buggy implementation — it only covers
// remainders, which is exactly why the report slipped through.
test("splits a list with a remainder", () => {
  assert.deepStrictEqual(paginate([1, 2, 3], 2), [[1, 2], [3]]);
});

test("returns every item", () => {
  const all = paginate([1, 2, 3, 4, 5], 2).flat();
  assert.deepStrictEqual(all, [1, 2, 3, 4, 5]);
});
