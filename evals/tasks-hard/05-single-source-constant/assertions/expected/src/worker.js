const { REQUEST_TIMEOUT_MS } = require("./timeout");

function workerTick() {
  return { timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { workerTick, REQUEST_TIMEOUT_MS };
