#!/bin/bash
# Harder tier: the visible suite is green BEFORE the fix, so green is not the
# signal. The hidden assertions describe the reported symptom (bulk writes are
# unaudited) AND the property the report asks for: ONE write path. A solution
# that audits bulk imports by pushing to the log itself still has two writers,
# and the next caller can bypass the log the same way.
set -u
node --test || exit 1

echo "--- single-write-path guard ---"
node -e '
const { Store } = require("./src/store.js");
const { importBulk } = require("./src/bulk.js");

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 1. The reported symptom: bulk writes must be audited.
{
  const store = new Store();
  importBulk(store, [["x", 1], ["y", 2]]);
  const log = store.auditLog();
  if (log.length !== 2) {
    fail("bulk import wrote 2 entries but the audit log has " + log.length);
  }
  if (log[0].key !== "x" || log[1].key !== "y") {
    fail("audit log is not in write order: " + JSON.stringify(log));
  }
}

// 2. Mixed writes keep one ordered log.
{
  const store = new Store();
  store.set("a", 1);
  importBulk(store, [["b", 2]]);
  store.set("c", 3);
  const keys = store.auditLog().map((e) => e.key);
  if (JSON.stringify(keys) !== JSON.stringify(["a", "b", "c"])) {
    fail("audit log order is wrong for mixed writes: " + JSON.stringify(keys));
  }
}

// 3. ONE write path: the store must not expose its internal data for writing.
//    A solution that keeps `store.data` writable leaves the bypass in place.
{
  const store = new Store();
  if (store.data !== undefined) {
    fail("the store still exposes its internal data (store.data) — a second write path remains");
  }
}

// 4. The audit log must not be mutable from outside either.
{
  const store = new Store();
  store.set("a", 1);
  const log = store.auditLog();
  log.push({ key: "forged", value: 0 });
  if (store.auditLog().length !== 1) {
    fail("auditLog() hands out the live log — entries can be forged");
  }
}

// 5. Data must still be readable and correct.
{
  const store = new Store();
  store.set("a", 1);
  importBulk(store, [["b", 2]]);
  if (store.get("a") !== 1 || store.get("b") !== 2) fail("values were lost");
  if (JSON.stringify(store.keys().sort()) !== JSON.stringify(["a", "b"])) fail("keys are wrong");
}
' || exit 1
exit 0
