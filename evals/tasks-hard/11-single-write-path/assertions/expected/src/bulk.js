// Bulk import. Writes through set() so every imported key is audited in order.
function importBulk(store, entries) {
  for (const [key, value] of entries) {
    store.set(key, value);
  }
}

module.exports = { importBulk };
