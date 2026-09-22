# Diagnose a numeric parser that silently accepts garbage

**Category:** regression

### Prompt
Run the project's tests, diagnose the failure across src/, fix the implementation, and verify that all tests pass. src/parse.js parseNumber() uses a base-10 integer parser, so it truncates decimals and mangles 0x-prefixed hex literals, and it returns NaN instead of rejecting empty or non-numeric input. Fix parseNumber() so it accepts decimal and 0x/0b literal strings (returning a number), and throws a TypeError for empty, whitespace-only, or non-numeric input.

### Assertion
`assertions/check.sh` runs `node test.js`, which covers decimals, negative
values, hex and binary literals, and the three rejection cases. Multi-turn
diagnostic task: one root cause (the wrong parser) explains several unrelated
looking assertion failures.
