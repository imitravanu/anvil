#!/bin/bash
# Harder tier, multi-turn: the second turn asked for the helper to be USED, so a
# solution that inlines its own parsing (or leaves the old Number(ttl) path) has
# not done the task even when every assertion passes.
set -u
echo "--- test suite ---"
node --test || exit 1

echo "--- uses-the-helper guard ---"
if ! grep -q 'require("./duration")' src/session.js; then
  echo "src/session.js does not use the duration helper it was asked to add"
  exit 1
fi
if grep -q 'Number(ttl)' src/session.js; then
  echo "the old Number(ttl) conversion is still in place"
  exit 1
fi
exit 0
