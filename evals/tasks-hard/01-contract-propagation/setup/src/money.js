// The shared formatter. Every amount in the app is stored as integer cents.
// NOTE: this one is used by three modules; changing its output shape without
// updating the call sites leaves the app printing inconsistent amounts.
function formatMoney(cents) {
  return String(cents);
}

module.exports = { formatMoney };
