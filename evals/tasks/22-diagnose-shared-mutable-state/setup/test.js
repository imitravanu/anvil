const assert = require("node:assert/strict");
const registry = require("./src/registry");

registry.clear();
registry.add("first");

const snapshot = registry.list();

registry.add("second");
const later = registry.list();

assert.deepEqual(
  snapshot,
  ["first"],
  "a snapshot returned by list() must not change when the registry changes afterwards"
);
assert.deepEqual(later, ["first", "second"], "list() must reflect the current registrations");

registry.clear();
assert.deepEqual(registry.list(), [], "clear() must empty the registry");

console.log("shared-mutable-state: ok");
