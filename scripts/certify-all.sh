#!/usr/bin/env bash
set -euo pipefail

# Run all provider certifications (Phase 18).
# API keys are read from environment variables or ~/.anvil/credentials.json. Never committed.
# Usage:
#   ./scripts/certify-all.sh
#   ./scripts/certify-all.sh --mock
#   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... ./scripts/certify-all.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "Running Anvil Provider Certification Suite across all providers..."
npx tsx scripts/certify-provider.ts --all "$@"
