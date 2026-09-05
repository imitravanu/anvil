#!/usr/bin/env node
// A missing/stale dist/ (fresh global install, partial publish, broken build)
// must fail with an actionable message — the CLI's own crash handlers live
// inside dist/ and are not loaded yet at this point.
import("../dist/index.js").catch((err) => {
  console.error(
    "Anvil failed to start (could not load dist/index.js). " +
      "Try reinstalling or rebuilding: " +
      (err && err.message ? err.message : String(err))
  );
  process.exit(1);
});
