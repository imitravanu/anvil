// Bulk import. This reaches into the store's internal data instead of calling
// set(), so imported keys are never audited.
function importBulk(store, entries) {
  for (const [key, value] of entries) {
    store.data[key] = value;
  }
}

module.exports = { importBulk };
