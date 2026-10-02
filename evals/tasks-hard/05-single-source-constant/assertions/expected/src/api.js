const { REQUEST_TIMEOUT_MS } = require("./timeout");

function apiCall(path) {
  return { path, timeoutMs: REQUEST_TIMEOUT_MS };
}

module.exports = { apiCall, REQUEST_TIMEOUT_MS };
