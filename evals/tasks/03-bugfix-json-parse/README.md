# Add safe fallback on JSON parse failure

**Category:** bugfix

### Prompt
In src/parser.js, safeParseJson(str, fallback) crashes if str is invalid JSON. Wrap JSON.parse in try/catch so it returns fallback if parsing fails.
