#!/bin/bash
# Harder tier: the visible suite is green BEFORE the fix, so green is not the
# signal. The hidden assertions describe the reported symptom (the parts do not
# sum back to the total) AND the fairness property the report implies: a split
# that balances by dumping the whole remainder on one line adds up but is not a
# weighted allocation.
set -u
node --test || exit 1

echo "--- exact-sum and fairness guard ---"
node -e '
const { allocate } = require("./src/allocate.js");

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const cases = [
  { total: 100, weights: [1, 1, 1] },
  { total: 10, weights: [1, 1, 1, 1] },
  { total: 1000, weights: [1, 2, 3] },
  { total: 7, weights: [5, 3, 2] },
  { total: 1, weights: [1, 1, 1] },
  { total: 0, weights: [1, 1] },
  { total: 999, weights: [7, 11, 13, 17] },
  { total: 12345, weights: [1, 1, 1, 1, 1, 1, 1] },
];

for (const c of cases) {
  const got = allocate(c.total, c.weights);
  const label = "allocate(" + c.total + ", [" + c.weights.join(",") + "])";

  if (got.length !== c.weights.length) {
    fail(label + " returned " + got.length + " lines, expected " + c.weights.length);
  }

  // 1. The reported symptom: the parts must add back up to the total.
  const sum = got.reduce((s, v) => s + v, 0);
  if (sum !== c.total) {
    fail(label + " sums to " + sum + ", expected " + c.total + " (got " + JSON.stringify(got) + ")");
  }

  // 2. Whole cents, never negative.
  for (const v of got) {
    if (!Number.isInteger(v)) fail(label + " produced a fractional cent: " + v);
    if (v < 0) fail(label + " produced a negative line: " + v);
  }

  // 3. Fairness: every line is the floor or the ceiling of its exact share.
  //    This is what a remainder-dumping solution violates even though it sums.
  const totalWeight = c.weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) continue;
  for (let i = 0; i < c.weights.length; i++) {
    const exact = (c.total * c.weights[i]) / totalWeight;
    const lo = Math.floor(exact);
    const hi = Math.ceil(exact);
    if (got[i] < lo || got[i] > hi) {
      fail(
        label + " line " + i + " = " + got[i] +
        " is outside its exact share [" + lo + ", " + hi + "] (" + exact + ")"
      );
    }
  }
}

// 4. Determinism: the same input must always produce the same split.
const a = JSON.stringify(allocate(1000, [1, 2, 3]));
const b = JSON.stringify(allocate(1000, [1, 2, 3]));
if (a !== b) fail("allocate is not deterministic: " + a + " vs " + b);
' || exit 1
exit 0
