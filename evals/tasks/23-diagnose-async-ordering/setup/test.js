const assert = require("node:assert/strict");
const { processAll } = require("./src/queue");

async function main() {
  const log = [];

  async function handler(n) {
    log.push(`start:${n}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    log.push(`end:${n}`);
    return n * 10;
  }

  const results = await processAll([1, 2, 3], handler);

  assert.deepEqual(results, [10, 20, 30], "processAll() must resolve every task result in order");
  assert.deepEqual(
    log,
    ["start:1", "end:1", "start:2", "end:2", "start:3", "end:3"],
    "each handler must finish before the next one starts"
  );

  console.log("async-ordering: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
