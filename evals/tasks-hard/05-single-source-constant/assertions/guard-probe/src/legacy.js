// GUARD PROBE: a second definition of the constant, outside the module the task
// said should own it. Nothing imports this file, so every assertion passes —
// only the single-source guard can fail this tree.
const REQUEST_TIMEOUT_MS = 5000;

module.exports = { REQUEST_TIMEOUT_MS };
