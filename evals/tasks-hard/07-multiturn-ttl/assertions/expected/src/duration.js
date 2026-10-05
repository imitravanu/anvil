// Duration strings: a run of <number><unit> segments, e.g. 1h30m.
const UNIT_MS = { h: 3_600_000, m: 60_000, s: 1_000 };

function parseDuration(text) {
  if (typeof text !== "string") throw new Error(`Not a duration: ${text}`);
  const segments = text.match(/\d+[hms]/g);
  // Reject anything that is not ENTIRELY segments: "abc", "", "1h30" must all
  // throw rather than silently parsing a prefix.
  if (!segments || segments.join("") !== text) {
    throw new Error(`Cannot parse duration: ${text}`);
  }
  let ms = 0;
  for (const segment of segments) {
    const unit = segment[segment.length - 1];
    ms += Number(segment.slice(0, -1)) * UNIT_MS[unit];
  }
  return ms;
}

module.exports = { parseDuration };
