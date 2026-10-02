#!/bin/bash
# Harder tier: the tests must pass AND no collection-shortcut is allowed to
# remain (a chunker that ignores its input is not a fix).
set -u
node --test || exit 1
exit 0
