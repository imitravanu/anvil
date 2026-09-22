# Diagnose a circular require crash across two modules

**Category:** regression

### Prompt
Run the project's tests, diagnose the failure across src/, fix the implementation, and verify that all tests pass. Requiring src/a.js currently throws a TypeError from src/b.js. src/a.js and src/b.js depend on each other, and one of them consumes the other's export while that module is still initializing. Fix src/b.js so both banner() and label() return the documented values: banner() must be "alpha@1.0.0" and label() must be "alpha-1.0.0".

### Assertion
`assertions/check.sh` runs `node test.js`, which imports both modules and asserts
both labels. Multi-turn diagnostic task: the agent must read the stack trace, grep
the module graph, and resolve the initialization-order defect rather than patching
a symptom.
