const assert = require("node:assert");
const math = require("./src/math.js");

assert.strictEqual(typeof math.modulo, "function");
assert.strictEqual(math.modulo(10, 3), 1);
assert.strictEqual(math.modulo(14, 7), 0);
assert.throws(() => math.modulo(5, 0), /Modulo by zero/);
console.log("PASS");
