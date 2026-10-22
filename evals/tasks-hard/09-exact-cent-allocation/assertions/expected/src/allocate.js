// Splits a total amount of cents across weighted lines.
//
// Largest-remainder (Hamilton) allocation: floor every exact share, then hand
// the leftover cents to the lines with the largest fractional part. The parts
// always sum to the total, and no line drifts more than one cent from its exact
// share.
function allocate(totalCents, weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / totalWeight);
  const out = exact.map((v) => Math.floor(v));
  const leftover = totalCents - out.reduce((sum, v) => sum + v, 0);

  // Largest fractional part first; index breaks ties so the result is stable.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((x, y) => y.frac - x.frac || x.i - y.i);

  for (let k = 0; k < leftover; k++) {
    out[order[k % order.length].i] += 1;
  }
  return out;
}

module.exports = { allocate };
