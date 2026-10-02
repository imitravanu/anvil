const test = require("node:test");
const assert = require("node:assert");
const { formatMoney } = require("../src/money.js");
const { cartTotal } = require("../src/cart.js");
const { invoiceLine } = require("../src/invoice.js");
const { receiptLine } = require("../src/receipt.js");

test("formatMoney renders a symbol and exactly two decimals", () => {
  assert.strictEqual(formatMoney(1234), "$12.34");
  assert.strictEqual(formatMoney(0), "$0.00");
  assert.strictEqual(formatMoney(5), "$0.05");
  assert.strictEqual(formatMoney(100000), "$1000.00");
});

test("cart, invoice and receipt all render through the same rule", () => {
  assert.strictEqual(cartTotal([{ priceCents: 1234, qty: 1 }]), "Total: $12.34");
  assert.strictEqual(cartTotal([{ priceCents: 5, qty: 2 }]), "Total: $0.10");
  assert.strictEqual(invoiceLine("Consulting", 1234), "Consulting: $12.34");
  assert.strictEqual(invoiceLine("Retainer", 0), "Retainer: $0.00");
  assert.strictEqual(receiptLine(1234), "Paid $12.34");
  assert.strictEqual(receiptLine(5), "Paid $0.05");
});
