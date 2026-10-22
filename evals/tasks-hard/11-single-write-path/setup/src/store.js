// A key/value store with an audit log.
//
// NOTE: set() audits, but the internal data is reachable from outside, so
// bulk.js writes straight into it and those writes never reach the log.
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
