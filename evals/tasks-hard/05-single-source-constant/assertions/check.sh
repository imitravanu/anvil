#!/bin/bash
# Harder tier: one definition, and every caller must import it. A solution that
# only makes the numbers agree (copying the same literal three times) is still
# three definitions and fails.
set -u
node --test || exit 1

echo "--- single-source guard ---"
if [ ! -f src/timeout.js ]; then
  echo "src/timeout.js does not exist — the constant was not centralized"
  exit 1
fi
DEFS=$(grep -rn 'REQUEST_TIMEOUT_MS *=' src/ --include='*.js' | grep -v '^src/timeout.js:' || true)
if [ -n "$DEFS" ]; then
  echo "the constant is still defined outside src/timeout.js:"
  echo "$DEFS"
  exit 1
fi
for f in src/api.js src/worker.js src/upload.js; do
  if ! grep -q 'require("./timeout' "$f"; then
    echo "$f does not import the shared constant"
    exit 1
  fi
done
exit 0
