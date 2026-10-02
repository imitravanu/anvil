const { formatMoney } = require("./money");

function receiptLine(cents) {
  return "Paid " + formatMoney(cents);
}

module.exports = { receiptLine };
