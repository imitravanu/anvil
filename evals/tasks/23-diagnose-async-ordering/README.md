# Diagnose an async queue that runs its handlers concurrently

**Category:** regression

### Prompt
Run the project's tests, diagnose the failure across src/, fix the implementation, and verify that all tests pass. src/queue.js processAll() starts every handler at once, so the work interleaves instead of running in task order and the start/end log comes out wrong. Rewrite processAll() so handlers run one at a time, in task order, and resolved values are returned in that same order.

### Assertion
`assertions/check.sh` runs `node test.js`, which records the start/end
interleaving of three handlers and asserts a strict sequential order, so the
defect fails deterministically rather than depending on microtask timing.
Multi-turn diagnostic task: the results array is already correctly ordered, so
the agent must read the source to find that concurrency — not ordering — is the
defect.
