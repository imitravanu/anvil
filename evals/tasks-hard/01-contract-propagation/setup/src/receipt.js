const { formatMoney } = require("./money");

// Receipts: a third variant — uses the shared formatter but strips the symbol,
// so it stops matching once formatMoney starts rendering one.
function receiptLine(cents) {
  return "Paid " + String(formatMoney(cents)).replace("$", "");
}

module.exports = { receiptLine };
