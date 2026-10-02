#!/bin/bash
# Harder tier: behaviour must be preserved AND the duplication must be gone.
# The rule itself now lives in exactly one file — that is the actual request.
set -u
node --test || exit 1

echo "--- single-implementation guard ---"
if [ ! -f src/slug.js ]; then
  echo "src/slug.js does not exist — the rule was not extracted"
  exit 1
fi
COPIES=$(grep -rln 'replace(/\[\^a-z0-9\]+/g' src/ --include='*.js' | grep -v '^src/slug.js$' || true)
if [ -n "$COPIES" ]; then
  echo "the slug rule is still implemented in more than one place:"
  echo "$COPIES"
  exit 1
fi
for f in src/posts.js src/tags.js; do
  if ! grep -q 'require("./slug' "$f"; then
    echo "$f does not import the shared rule"
    exit 1
  fi
done
exit 0
