// Awaiting inside a plain for..of keeps the handlers strictly sequential, so
// each task's work finishes before the next one starts.
async function processAll(tasks, handler) {
  const results = [];
  for (const task of tasks) {
    results.push(await handler(task));
  }
  return results;
}

module.exports = { processAll };
