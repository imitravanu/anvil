const DEFAULTS = {
  maxRetries: 1,
  timeoutMs: 1000,
};

function readSettings(settings) {
  return {
    maxRetries: settings.maxRetries ?? DEFAULTS.maxRetries,
    timeoutMs: settings.timeoutMs ?? DEFAULTS.timeoutMs,
  };
}

module.exports = { readSettings, DEFAULTS };
