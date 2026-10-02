const { formatMoney } = require("./money");

function cartTotal(items) {
  const cents = items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
  return "Total: " + formatMoney(cents);
}

module.exports = { cartTotal, formatMoney };
