const DEFAULTS = {
  name: "session",
  ttlSeconds: 60,
};

// GUARD PROBE: every assertion passes — numbers and strings both work — but the
// parsing was reinvented inline instead of using the helper the second turn
// asked for, and the old Number(ttl) path is still there. Only the structural
// guard can fail this tree.
function createSession(options = {}) {
  const ttl = options.ttl ?? DEFAULTS.ttlSeconds;
  const ttlMs =
    typeof ttl === "number"
      ? Number(ttl) * 1000
      : (ttl.match(/\d+[hms]/g) ?? []).reduce(
          (sum, segment) =>
            sum +
            Number(segment.slice(0, -1)) *
              { h: 3_600_000, m: 60_000, s: 1_000 }[segment[segment.length - 1]],
          0
        );
  return {
    name: options.name ?? DEFAULTS.name,
    ttlMs,
  };
}

module.exports = { createSession, DEFAULTS };
