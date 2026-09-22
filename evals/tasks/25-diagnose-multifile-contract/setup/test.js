const assert = require("node:assert/strict");
const { priceItems } = require("./src/pricing");
const { invoiceTotal } = require("./src/invoice");

const items = [
  { unitCents: 250, quantity: 2 },
  { unitCents: 500, quantity: 1 },
];

assert.deepEqual(
  priceItems(items),
  { totalCents: 1000 },
  "priceItems() must expose { totalCents } as integer cents"
);

assert.equal(invoiceTotal(items, 0), 1000, "a zero tax rate must leave the total unchanged");
assert.equal(invoiceTotal(items, 0.1), 1100, "tax must be applied to the cents total");
assert.equal(invoiceTotal([], 0.5), 0, "an empty cart must total zero");

console.log("multifile-contract: ok");
