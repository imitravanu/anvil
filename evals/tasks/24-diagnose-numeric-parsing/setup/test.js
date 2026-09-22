const assert = require("node:assert/strict");
const { parseNumber } = require("./src/parse");

assert.equal(parseNumber("42"), 42, "decimal integers must parse");
assert.equal(parseNumber("  -7.5  "), -7.5, "signs, decimals and surrounding spaces must parse");
assert.equal(parseNumber("0x1f"), 31, "hex literals must parse");
assert.equal(parseNumber("0b1011"), 11, "binary literals must parse");

assert.throws(() => parseNumber(""), TypeError, "empty input must be rejected");
assert.throws(() => parseNumber("   "), TypeError, "whitespace-only input must be rejected");
assert.throws(() => parseNumber("abc"), TypeError, "non-numeric input must be rejected");

console.log("numeric-parsing: ok");
