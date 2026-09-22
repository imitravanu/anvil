const { priceItems } = require("./pricing");

function invoiceTotal(items, taxRate) {
  const priced = priceItems(items);
  return Math.round(priced.totalCents * (1 + taxRate));
}

module.exports = { invoiceTotal };
