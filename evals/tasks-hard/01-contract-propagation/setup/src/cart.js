const { formatMoney } = require("./money");

// Cart totals: hand-formats its own amount (the inconsistency the task is about).
function cartTotal(items) {
  const cents = items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
  return "Total: " + (cents / 100).toFixed(2);
}

module.exports = { cartTotal, formatMoney };
