#!/bin/bash
# Harder tier: the suite must pass AND no legacy spelling may survive. A reader
# that still accepts `max_retries` is a half-migration, and the request was one
# spelling.
set -u
node --test || exit 1

echo "--- no-legacy-key guard ---"
LEGACY=$(grep -rn 'max_retries' . --include='*.js' --include='*.json' --include='*.md' \
  --exclude-dir=node_modules 2>/dev/null | grep -v './test/' || true)
if [ -n "$LEGACY" ]; then
  echo "the legacy key spelling is still present:"
  echo "$LEGACY"
  exit 1
fi
exit 0
