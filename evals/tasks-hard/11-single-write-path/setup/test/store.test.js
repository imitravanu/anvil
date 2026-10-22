const test = require("node:test");
const assert = require("node:assert");
const { Store } = require("../src/store.js");
const { importBulk } = require("../src/bulk.js");

// The visible suite checks that the data lands. It never looks at the audit log,
// so it is green before and after the fix and says nothing about the bug.
test("set stores a value", () => {
  const store = new Store();
  store.set("a", 1);
  assert.strictEqual(store.get("a"), 1);
});

test("bulk import stores every entry", () => {
  const store = new Store();
  importBulk(store, [["x", 1], ["y", 2]]);
  assert.deepStrictEqual(store.keys().sort(), ["x", "y"]);
  assert.strictEqual(store.get("y"), 2);
});
