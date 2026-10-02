const test = require("node:test");
const assert = require("node:assert");
const { slugify, postPath } = require("../src/posts.js");
const { tagPath } = require("../src/tags.js");

test("slugify keeps its public behaviour", () => {
  assert.strictEqual(slugify("  Hello, World!  "), "hello-world");
  assert.strictEqual(slugify("A--B"), "a-b");
  assert.strictEqual(slugify("!!!"), "");
});

test("posts and tags build paths from the shared rule", () => {
  assert.strictEqual(postPath("Hello World"), "/posts/hello-world");
  assert.strictEqual(tagPath("Node JS"), "/tags/node-js");
});
