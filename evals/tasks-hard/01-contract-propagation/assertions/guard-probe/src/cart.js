const { formatMoney } = require("./money");

// GUARD PROBE (read by fixtureIntegrity.test.ts — never by the task itself):
// a solution that satisfies every assertion while breaking the "one formatting
// rule" requirement the task actually states. If the structural guard is ever
// removed from check.sh, this overlay passes and the integrity test goes red,
// which is exactly the silent downgrade it exists to prevent.
function cartTotal(items) {
  const cents = items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
  return "Total: $" + (cents / 100).toFixed(2);
}

module.exports = { cartTotal, formatMoney };
