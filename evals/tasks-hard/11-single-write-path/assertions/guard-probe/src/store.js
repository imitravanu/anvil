// Guard probe: bulk imports now appear in the audit log, so the reported
// symptom looks fixed — but bulk.js still writes into the store's data and
// pushes its own audit entries, so there are still two write paths and the
// store still exposes its internals. If this file ever passes check.sh, the
// single-write-path guard has been removed.
class Store {
  constructor() {
    this.data = {};
    this.audit = [];
  }

  set(key, value) {
    this.data[key] = value;
    this.audit.push({ key, value });
  }

  get(key) {
    return this.data[key];
  }

  keys() {
    return Object.keys(this.data);
  }

  auditLog() {
    return this.audit.slice();
  }
}

module.exports = { Store };
