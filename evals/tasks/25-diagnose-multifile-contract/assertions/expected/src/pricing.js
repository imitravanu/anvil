function priceItems(items) {
  const totalCents = items.reduce((total, item) => total + item.unitCents * item.quantity, 0);
  return { totalCents };
}

module.exports = { priceItems };
