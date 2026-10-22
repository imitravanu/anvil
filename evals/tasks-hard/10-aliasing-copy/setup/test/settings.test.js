const test = require("node:test");
const assert = require("node:assert");
const { SettingsStore } = require("../src/settings.js");

// The visible suite only reads. It never mutates what get() returned, so it is
// green before and after the fix and says nothing about the reported bug.
test("returns the values that were set", () => {
  const store = new SettingsStore();
  store.set("editor", { theme: "dark" });
  assert.deepStrictEqual(store.get("editor"), { theme: "dark" });
});

test("returns undefined for an unknown section", () => {
  const store = new SettingsStore();
  assert.strictEqual(store.get("missing"), undefined);
});
