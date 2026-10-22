// Guard probe: this balances the ledger by dumping the whole remainder on the
// last line. It sums correctly, so the reported symptom looks fixed, but the
// split is no longer a weighted allocation — the last line drifts more than a
// cent from its exact share. If this file ever passes check.sh, the fairness
// guard has been removed.
function allocate(totalCents, weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const out = weights.map((w) => Math.floor((totalCents * w) / totalWeight));
  const leftover = totalCents - out.reduce((sum, v) => sum + v, 0);
  if (out.length > 0) out[out.length - 1] += leftover;
  return out;
}

module.exports = { allocate };
