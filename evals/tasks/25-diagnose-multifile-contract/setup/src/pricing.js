// BUG: exposes `amount`, while the consumer reads `totalCents`, so every
// downstream total becomes NaN.
function priceItems(items) {
  const amount = items.reduce((total, item) => total + item.unitCents * item.quantity, 0);
  return { amount };
}

module.exports = { priceItems };
