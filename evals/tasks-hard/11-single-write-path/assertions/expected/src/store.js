// A key/value store with an audit log.
//
// The data is private and set() is the only writer, so every write is audited
// by construction. bulk.js goes through set() like every other caller.
class Store {
  #data = {};
  #audit = [];

  set(key, value) {
    this.#data[key] = value;
    this.#audit.push({ key, value });
  }

  get(key) {
    return this.#data[key];
  }

  keys() {
    return Object.keys(this.#data);
  }

  auditLog() {
    return this.#audit.map((entry) => ({ ...entry }));
  }
}

module.exports = { Store };
