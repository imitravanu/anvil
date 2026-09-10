const assert = require("node:assert");
const { paginate } = require("./src/paginate.js");

const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const p1 = paginate(data, 1, 3);
assert.deepStrictEqual(p1, [1, 2, 3]);
const p2 = paginate(data, 2, 3);
assert.deepStrictEqual(p2, [4, 5, 6]);
console.log("PASS");
