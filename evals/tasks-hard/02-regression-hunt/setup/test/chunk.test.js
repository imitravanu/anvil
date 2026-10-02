const test = require("node:test");
const assert = require("node:assert");
const { chunk } = require("../src/chunk.js");
const { safeSlice } = require("../src/slice-safe.js");

test("keeps the trailing remainder", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("returns one chunk when the list fits", () => {
  assert.deepStrictEqual(chunk([1, 2, 3], 4), [[1, 2, 3]]);
});

test("handles an exact multiple without an empty tail", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test("handles the empty list", () => {
  assert.deepStrictEqual(chunk([], 3), []);
});

test("safeSlice clamps a window past the end", () => {
  assert.deepStrictEqual(safeSlice([1, 2, 3], 1, 10), [2, 3]);
});
