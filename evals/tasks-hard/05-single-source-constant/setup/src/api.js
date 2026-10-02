const REQUEST_TIMEOUT_MS = 5000;

function apiCall(path) {
  return { path, timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { apiCall, REQUEST_TIMEOUT_MS };
