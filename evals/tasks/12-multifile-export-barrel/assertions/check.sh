#!/bin/bash
node -e '
const barrel = require("./src/index.js");
if (typeof barrel.add !== "function" || typeof barrel.formatCurrency !== "function") process.exit(1);
if (barrel.add(2, 3) !== 5) process.exit(1);
if (barrel.formatCurrency(10) !== "$10.00") process.exit(1);
console.log("PASS");
'
exit $?
