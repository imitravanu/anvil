const assert = require("node:assert");
const { safeParseJson } = require("./src/parser.js");

assert.deepStrictEqual(safeParseJson("{\"a\": 1}", {}), { a: 1 });
assert.deepStrictEqual(safeParseJson("invalid json", { default: true }), { default: true });
console.log("PASS");
