const { safeSlice } = require("./slice-safe");

// Splits a list into chunks of `size`. The LAST chunk keeps its remainder: the
// batcher downstream drops data if a partial tail is silently discarded.
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(safeSlice(items, i, size));
  }
  return out;
}

module.exports = { chunk };
