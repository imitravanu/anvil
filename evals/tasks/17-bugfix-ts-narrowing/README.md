# Fix discriminated-union narrowing in an API client

**Category:** bugfix

### Prompt
src/client.ts does not compile: unwrap() narrows only the "error" variant and then reads `data`, which the "pending" variant does not have. Fix unwrap() so it handles every variant of ApiResponse<T>: return `data` for "success", throw new Error(res.message) for "error", and throw new Error("response is pending") for "pending". Do not widen the types or use escape-hatch casts. Assertions type-check the project and then run test.ts.

### Assertion
`assertions/check.sh` type-checks the project with `strict: true` (so a widened
signature or a missing variant fails the build) and then runs the compiled
`test.ts`, which exercises all three variants.
