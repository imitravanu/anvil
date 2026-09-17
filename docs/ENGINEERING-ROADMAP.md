# Anvil engineering roadmap

## Current state

M0 is in progress. The protected-file gate blocker was removed by restoring gate artifacts from Git after backing them up. Credential `0600` behavior is covered by a focused test, first-run newline corruption is fixed, and the rewind visual baseline is locale-independent.

## Release track

1. **M0 — Baseline:** Complete the full gate and publish a reproducible readiness report.
2. **M1 — Execution authority:** Ensure approvals, refusals, execution, history, and ledger agree.
3. **M2 — Verification truthfulness:** Verify final repairs, record completed mutations during cancellation, and prevent false success reporting.
4. **M3 — Integration hardening:** Validate providers, teams, plugins, MCP, and LSP through production entry paths.
5. **M4 — Benchmarks:** Add reproducible engine and agent-task evaluations with published limitations.
6. **M5 — Public release:** Ship only advertised behavior that passes clean-install and compatibility checks.

Do not add new features ahead of M0–M2. Reuse the stabilization backlog, test through real entry paths, and require evidence receipts before marking any milestone complete.
