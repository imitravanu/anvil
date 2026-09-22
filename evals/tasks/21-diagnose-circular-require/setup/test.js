const assert = require("node:assert/strict");
const { banner } = require("./src/a");
const { label } = require("./src/b");

assert.equal(banner(), "alpha@1.0.0", "banner() must combine the module name and version");
assert.equal(label(), "alpha-1.0.0", "label() must combine the module name and version");

console.log("circular-require: ok");
