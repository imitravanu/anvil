#!/bin/bash
# Harder tier: the visible suite is green BEFORE the fix, so green is not the
# signal. The hidden assertions describe the reported symptom AND the property
# the report implies: a comparator the queue can rely on must be a total order,
# so equal-priority rules need a deterministic tiebreak.
set -u
node --test || exit 1

echo "--- total-order guard ---"
node -e '
const { compareRules } = require("./src/compare.js");

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 1. Priority is descending.
const high = { id: "r-1", priority: 5 };
const low = { id: "r-2", priority: 1 };
if (compareRules(high, low) >= 0) fail("a higher priority must sort before a lower one");
if (compareRules(low, high) <= 0) fail("a lower priority must sort after a higher one");

// 2. Equal priority breaks the tie on id ascending — this is the half of the
//    report the visible suite never exercises.
const b = { id: "b", priority: 3 };
const a = { id: "a", priority: 3 };
if (compareRules(a, b) >= 0) fail("equal priority must order id ascending (a before b)");
if (compareRules(b, a) <= 0) fail("equal priority must order id ascending (b after a)");

// 3. Antisymmetry: a comparator that is not antisymmetric is not a total order.
const pairs = [[high, low], [a, b], [a, a], [b, b], [high, a], [low, b]];
for (const [x, y] of pairs) {
  const fwd = Math.sign(compareRules(x, y));
  const rev = Math.sign(compareRules(y, x));
  if (fwd !== -rev) {
    fail("not antisymmetric for " + x.id + " / " + y.id + ": " + fwd + " vs " + rev);
  }
}

// 4. Determinism: the report says the queue reorders itself between runs on the
//    same input. Sorting shuffled copies must always produce one order.
const rules = [
  { id: "r-9", priority: 2 },
  { id: "r-3", priority: 2 },
  { id: "r-7", priority: 1 },
  { id: "r-1", priority: 2 },
  { id: "r-5", priority: 3 },
];
const expectedOrder = ["r-5", "r-1", "r-3", "r-9", "r-7"];
const shuffles = [
  [0, 1, 2, 3, 4],
  [4, 3, 2, 1, 0],
  [2, 0, 4, 1, 3],
  [3, 1, 0, 4, 2],
];
for (const order of shuffles) {
  const got = order.map((i) => rules[i]).sort(compareRules).map((r) => r.id);
  if (JSON.stringify(got) !== JSON.stringify(expectedOrder)) {
    fail("sort is not deterministic: got " + JSON.stringify(got) + ", expected " + JSON.stringify(expectedOrder));
  }
}
' || exit 1
exit 0
