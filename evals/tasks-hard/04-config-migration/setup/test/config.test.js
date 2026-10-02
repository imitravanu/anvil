const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { readSettings, DEFAULTS } = require("../src/config.js");

test("reads maxRetries from the settings file", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config", "settings.json"), "utf8")
  );
  assert.strictEqual(readSettings(settings).maxRetries, 3);
  assert.strictEqual(readSettings(settings).timeoutMs, 5000);
});

test("falls back to the default when the key is absent", () => {
  assert.strictEqual(readSettings({}).maxRetries, DEFAULTS.maxRetries);
});
