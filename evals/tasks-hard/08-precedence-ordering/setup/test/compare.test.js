const test = require("node:test");
const assert = require("node:assert");
const { compareRules } = require("../src/compare.js");

// The visible suite only covers the case the queue happened to hit first: two
// rules whose priorities already differ. It is green before and after the fix.
test("orders a higher priority before a lower one", () => {
  const high = { id: "r-1", priority: 5 };
  const low = { id: "r-2", priority: 1 };
  assert.deepStrictEqual([low, high].sort(compareRules), [high, low]);
});

test("a rule compares equal to itself", () => {
  const rule = { id: "r-1", priority: 3 };
  assert.strictEqual(compareRules(rule, rule), 0);
});
