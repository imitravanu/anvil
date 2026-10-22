// Guard probe: audits the import by writing the log entry itself, instead of
// routing the write through set(). Two writers remain.
function importBulk(store, entries) {
  for (const [key, value] of entries) {
    store.data[key] = value;
    store.audit.push({ key, value });
  }
}

module.exports = { importBulk };
