# Diagnose a leaked internal array in a registry module

**Category:** regression

### Prompt
Run the project's tests, diagnose the failure across src/, fix the implementation, and verify that all tests pass. src/registry.js exposes a list() accessor, but a snapshot it returns keeps changing after later registrations, because callers receive the registry's own internal array instead of a value. Fix src/registry.js so list() returns a snapshot that callers cannot use to mutate registry internals, while add() and clear() keep working as before.

### Assertion
`assertions/check.sh` runs `node test.js`, which takes a snapshot, mutates the
registry, and asserts the earlier snapshot did not change. Multi-turn diagnostic
task: the failing assertion points at list(), so the agent must trace the
aliasing rather than the assertion helper.
