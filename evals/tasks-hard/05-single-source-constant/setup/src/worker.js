const REQUEST_TIMEOUT_MS = 8000;

function workerTick() {
  return { timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { workerTick, REQUEST_TIMEOUT_MS };
