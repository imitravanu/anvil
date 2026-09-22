#!/bin/bash
# Offline, deterministic assertion: run the sandbox's unittest suite.
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to assert this task" >&2
  exit 1
fi

python3 -m unittest test_processor.py
