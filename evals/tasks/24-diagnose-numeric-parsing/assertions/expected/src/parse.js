function parseNumber(input) {
  if (typeof input !== "string") {
    throw new TypeError(`input must be a string, received ${typeof input}`);
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new TypeError("input must not be empty");
  }

  // Number() understands decimal, 0x and 0b literal strings; a base-10 integer
  // parse would truncate decimals and read "0x1f" as 0.
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new TypeError(`input is not a number: ${input}`);
  }
  return value;
}

module.exports = { parseNumber };
