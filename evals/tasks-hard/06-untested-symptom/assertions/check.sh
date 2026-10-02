#!/bin/bash
# Harder tier: the visible suite is green BEFORE the fix, so green is not the
# signal. The hidden assertions describe the reported symptom.
set -u
node --test || exit 1

echo "--- reported-symptom guard ---"
node -e '
const { paginate } = require("./src/paginate.js");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  { items: [1, 2, 3, 4], size: 2, want: [[1, 2], [3, 4]] },
  { items: [1, 2, 3], size: 2, want: [[1, 2], [3]] },
  { items: [], size: 2, want: [] },
  { items: [1, 2, 3, 4, 5], size: 5, want: [[1, 2, 3, 4, 5]] },
];
for (const c of cases) {
  const got = paginate(c.items, c.size);
  if (!eq(got, c.want)) {
    console.error("paginate(" + JSON.stringify(c.items) + ", " + c.size + ") = " + JSON.stringify(got) + ", expected " + JSON.stringify(c.want));
    process.exit(1);
  }
}
' || exit 1
exit 0
