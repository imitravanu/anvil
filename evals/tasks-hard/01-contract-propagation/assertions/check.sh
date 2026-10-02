#!/bin/bash
# Harder tier: passing tests is necessary but not sufficient. The task asks for
# ONE formatting rule, so a solution that leaves hand-rolled currency math in a
# call site fails even when the assertions happen to pass.
set -u
echo "--- test suite ---"
node --test || exit 1

echo "--- one-formatting-rule guard ---"
HANDROLLED=$(grep -rn 'toFixed(' src/ --include='*.js' | grep -v '^src/money.js:' || true)
if [ -n "$HANDROLLED" ]; then
  echo "hand-rolled decimal formatting remains outside src/money.js:"
  echo "$HANDROLLED"
  exit 1
fi
CENTS_MATH=$(grep -rn '/ 100' src/ --include='*.js' | grep -v '^src/money.js:' || true)
if [ -n "$CENTS_MATH" ]; then
  echo "hand-rolled cent conversion remains outside src/money.js:"
  echo "$CENTS_MATH"
  exit 1
fi
exit 0
