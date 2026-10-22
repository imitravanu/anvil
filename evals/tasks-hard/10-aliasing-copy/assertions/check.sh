#!/bin/bash
# Harder tier: the visible suite is green BEFORE the fix, so green is not the
# signal. The hidden assertions describe the reported symptom (mutating what
# get() returned changes a later read) AND the depth the report implies: the
# store holds nested objects and arrays, so a shallow copy still leaks.
set -u
node --test || exit 1

echo "--- no-aliasing guard (including nested state) ---"
node -e '
const { SettingsStore } = require("./src/settings.js");

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const seed = () => ({
  editor: { theme: "dark", cursor: { blink: true, width: 2 } },
  recent: ["a.js", "b.js"],
});

// 1. Top-level mutation must not reach the store.
{
  const store = new SettingsStore(seed());
  const got = store.get("editor");
  got.theme = "light";
  if (store.get("editor").theme !== "dark") {
    fail("mutating a top-level field of get() changed the store");
  }
}

// 2. NESTED mutation must not reach the store — a shallow copy fails here.
{
  const store = new SettingsStore(seed());
  const got = store.get("editor");
  got.cursor.blink = false;
  if (store.get("editor").cursor.blink !== true) {
    fail("mutating a nested field of get() changed the store (shallow copy)");
  }
}

// 3. Array mutation must not reach the store.
{
  const store = new SettingsStore(seed());
  const got = store.get("recent");
  got.push("c.js");
  if (store.get("recent").length !== 2) {
    fail("pushing to an array from get() changed the store");
  }
}

// 4. Adding a key must not reach the store.
{
  const store = new SettingsStore(seed());
  const got = store.get("editor");
  got.fontSize = 14;
  if ("fontSize" in store.get("editor")) {
    fail("adding a key to get() changed the store");
  }
}

// 5. Two reads must not share identity, or the leak is still there.
{
  const store = new SettingsStore(seed());
  const a = store.get("editor");
  const b = store.get("editor");
  if (a === b) fail("two get() calls returned the same object");
  if (a.cursor === b.cursor) fail("two get() calls share a nested object");
}

// 6. The values must still be correct after all that isolation.
{
  const store = new SettingsStore(seed());
  const got = store.get("editor");
  if (got.theme !== "dark" || got.cursor.width !== 2) {
    fail("get() no longer returns the stored values: " + JSON.stringify(got));
  }
}

// 7. set() must still store what it is given, and get() must reflect it.
{
  const store = new SettingsStore();
  store.set("editor", { theme: "solarized" });
  if (store.get("editor").theme !== "solarized") fail("set() then get() lost the value");
}
' || exit 1
exit 0
