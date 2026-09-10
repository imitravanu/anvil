const assert = require("node:assert");
const { slugify } = require("./src/slugify.js");

assert.strictEqual(slugify("Hello World!"), "hello-world");
assert.strictEqual(slugify("  Anvil  -- Agent -- CLI! "), "anvil-agent-cli");
console.log("PASS");
