// BUG: a base-10 integer parse drops fractional parts, reads "0x1f" as 0, and
// answers NaN (rather than rejecting) for empty or non-numeric input.
function parseNumber(input) {
  return Number.parseInt(input, 10);
}

module.exports = { parseNumber };
