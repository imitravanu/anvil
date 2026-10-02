const REQUEST_TIMEOUT_MS = 3000;

function uploadPlan(size) {
  return { size, timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { uploadPlan, REQUEST_TIMEOUT_MS };
