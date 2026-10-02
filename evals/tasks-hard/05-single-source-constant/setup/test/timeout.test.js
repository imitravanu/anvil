const test = require("node:test");
const assert = require("node:assert");
const { apiCall } = require("../src/api.js");
const { workerTick } = require("../src/worker.js");
const { uploadPlan } = require("../src/upload.js");

test("every caller reports the same request timeout", () => {
  const t = apiCall("/x").timeoutMs;
  assert.strictEqual(workerTick().timeoutMs, t);
  assert.strictEqual(uploadPlan(10).timeoutMs, t);
});
