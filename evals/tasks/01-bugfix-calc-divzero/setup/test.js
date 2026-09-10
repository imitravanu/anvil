const assert = require("node:assert");
const { divide } = require("./src/calc.js");

assert.strictEqual(divide(10, 2), 5);
assert.throws(() => divide(10, 0), /Cannot divide by zero/);
console.log("PASS");
