const { formatMoney } = require("./money");

// Invoices: another hand-rolled format, with a currency prefix and no padding.
function invoiceLine(description, cents) {
  return `${description}: $${cents / 100}`;
}

module.exports = { invoiceLine };
