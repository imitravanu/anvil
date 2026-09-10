const assert = require("node:assert");
const { SimpleCache } = require("./src/cache.js");

const cache = new SimpleCache(2);
cache.set("a", 1);
cache.set("b", 2);
assert.strictEqual(cache.get("a"), 1);
cache.set("c", 3);
assert.strictEqual(cache.get("a"), undefined);
assert.strictEqual(cache.get("b"), 2);
assert.strictEqual(cache.get("c"), 3);
console.log("PASS");
