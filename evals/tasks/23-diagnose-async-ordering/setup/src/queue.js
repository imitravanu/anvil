// BUG: starting every handler at once lets them interleave, so the work does
// not actually run in task order — only the results array happens to be.
async function processAll(tasks, handler) {
  return Promise.all(tasks.map((task) => handler(task)));
}

module.exports = { processAll };
