const DEFAULTS = {
  name: "session",
  ttlSeconds: 60,
};

// `ttl` is documented as a number of seconds. Callers have started passing
// "30m" instead, which this turns into NaN.
function createSession(options = {}) {
  const ttl = options.ttl ?? DEFAULTS.ttlSeconds;
  return {
    name: options.name ?? DEFAULTS.name,
    ttlMs: Number(ttl) * 1000,
  };
}

module.exports = { createSession, DEFAULTS };
