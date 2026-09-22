const { priceItems } = require("./pricing");

function invoiceTotal(items, taxRate) {
  const { totalCents } = priceItems(items);
  return Math.round(totalCents * (1 + taxRate));
}

module.exports = { invoiceTotal };
