// A tiny settings store. Sections are held in memory and handed out by get().
//
// get() returns a DEEP copy: callers own what they receive, so mutating it
// (including nested objects and arrays) can never reach the store.
class SettingsStore {
  constructor(initial = {}) {
    this.sections = {};
    for (const [name, values] of Object.entries(initial)) {
      this.sections[name] = structuredClone(values);
    }
  }

  get(section) {
    const values = this.sections[section];
    return values === undefined ? undefined : structuredClone(values);
  }

  set(section, values) {
    this.sections[section] = structuredClone(values);
  }
}

module.exports = { SettingsStore };
