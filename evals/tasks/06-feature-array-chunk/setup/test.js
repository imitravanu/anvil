const assert = require("node:assert");
const { chunk } = require("./src/chunk.js");

assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepStrictEqual(chunk([], 3), []);
assert.deepStrictEqual(chunk([1, 2], 5), [[1, 2]]);
console.log("PASS");
