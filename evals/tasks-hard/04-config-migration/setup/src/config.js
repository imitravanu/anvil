const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_TIMEOUT_MS = 1000;

const DEFAULTS = {
  maxRetries: DEFAULT_MAX_RETRIES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

// Reads the legacy key first, then falls back to the modern one.
function readSettings(settings) {
  return {
    maxRetries: settings.max_retries ?? settings.maxRetries ?? DEFAULTS.maxRetries,
    timeoutMs: settings.timeoutMs ?? DEFAULTS.timeoutMs,
  };
}

module.exports = { readSettings, DEFAULTS };
