const { formatMoney } = require("./money");

function invoiceLine(description, cents) {
  return `${description}: ${formatMoney(cents)}`;
}

module.exports = { invoiceLine };
