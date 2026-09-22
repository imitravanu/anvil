#!/bin/bash
# Offline, deterministic assertion: type-check the sandbox project with the
# workspace's own TypeScript, then run the compiled behaviour test.
#
# TypeScript is resolved through $0 rather than the sandbox cwd, so the check
# works from any working directory and never reaches for the network (a bare
# `npx tsc` in a temp dir would try to download the compiler).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TSC="$SCRIPT_DIR/../../../../node_modules/.bin/tsc"

if [ ! -x "$TSC" ]; then
  echo "TypeScript not found at $TSC (run 'npm install' at the repository root)" >&2
  exit 1
fi

"$TSC" -p tsconfig.json
node .out/test.js
