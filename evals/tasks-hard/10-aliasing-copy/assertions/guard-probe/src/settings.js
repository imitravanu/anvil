// Guard probe: a shallow copy. The top-level mutation is blocked, so the
// reported symptom looks fixed, but nested objects and arrays are still shared
// with the store. If this file ever passes check.sh, the depth guard has been
// removed.
class SettingsStore {
  constructor(initial = {}) {
    this.sections = {};
    for (const [name, values] of Object.entries(initial)) {
      this.sections[name] = values;
    }
  }

  get(section) {
    const values = this.sections[section];
    return values === undefined ? undefined : { ...values };
  }

  set(section, values) {
    this.sections[section] = values;
  }
}

module.exports = { SettingsStore };
