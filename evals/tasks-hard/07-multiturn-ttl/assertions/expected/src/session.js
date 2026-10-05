const { parseDuration } = require("./duration");

const DEFAULTS = {
  name: "session",
  ttlSeconds: 60,
};

// `ttl` accepts a number of seconds (long-standing behaviour, unchanged) or a
// duration string like "30m".
function createSession(options = {}) {
  const ttl = options.ttl ?? DEFAULTS.ttlSeconds;
  const ttlMs = typeof ttl === "number" ? ttl * 1000 : parseDuration(ttl);
  return {
    name: options.name ?? DEFAULTS.name,
    ttlMs,
  };
}

module.exports = { createSession, DEFAULTS };
