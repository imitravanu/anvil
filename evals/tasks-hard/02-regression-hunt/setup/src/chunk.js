const { safeSlice } = require("./slice-safe");

// Splits a list into chunks of `size`. The LAST chunk must keep its remainder:
// the batcher downstream drops data if a partial tail is silently discarded.
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(safeSlice(items, i, size));
  }
  if (out.length > 1) out.pop();
  return out;
}

module.exports = { chunk };
