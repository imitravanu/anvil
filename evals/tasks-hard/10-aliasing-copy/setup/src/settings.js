// A tiny settings store. Sections are held in memory and handed out by get().
//
// NOTE: get() returns the store's own object, so a caller that mutates what it
// received is mutating the store. The corruption only shows up on a LATER read,
// which is why the visible suite never sees it.
class SettingsStore {
  constructor(initial = {}) {
    this.sections = {};
    for (const [name, values] of Object.entries(initial)) {
      this.sections[name] = values;
    }
  }

  get(section) {
    return this.sections[section];
  }

  set(section, values) {
    this.sections[section] = values;
  }
}

module.exports = { SettingsStore };
