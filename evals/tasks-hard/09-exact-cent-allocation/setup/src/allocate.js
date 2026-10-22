// Splits a total amount of cents across weighted lines.
//
// NOTE: rounding each line independently means the parts do not add back up to
// the total — the ledger is short (or long) by a cent or two on most invoices.
function allocate(totalCents, weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => Math.round((totalCents * w) / totalWeight));
}

module.exports = { allocate };
