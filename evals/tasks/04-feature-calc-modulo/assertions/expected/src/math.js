function add(a, b) { return a + b; }
function multiply(a, b) { return a * b; }
function modulo(a, b) {
  if (b === 0) throw new Error("Modulo by zero");
  return a % b;
}
module.exports = { add, multiply, modulo };
