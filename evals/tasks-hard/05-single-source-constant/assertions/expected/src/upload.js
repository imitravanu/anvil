const { REQUEST_TIMEOUT_MS } = require("./timeout");

function uploadPlan(size) {
  return { size, timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { uploadPlan, REQUEST_TIMEOUT_MS };
