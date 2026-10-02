const DEFAULTS = {
  maxRetries: 1,
  timeoutMs: 1000,
};

// Reads the legacy key first, then falls back to the modern one.
function readSettings(settings) {
  return {
    maxRetries: settings.max_retries ?? settings.maxRetries ?? DEFAULTS.maxRetries,
    timeoutMs: settings.timeoutMs ?? DEFAULTS.timeoutMs,
  };
}

module.exports = { readSettings, DEFAULTS };
