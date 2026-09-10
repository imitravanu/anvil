const assert = require("node:assert");
const { sortByPriority } = require("./src/priority.js");

const items = [{ id: "low", priority: 1 }, { id: "high", priority: 10 }, { id: "mid", priority: 5 }];
const sorted = sortByPriority(items);
assert.strictEqual(sorted[0].id, "high");
assert.strictEqual(sorted[1].id, "mid");
assert.strictEqual(sorted[2].id, "low");
console.log("PASS");
