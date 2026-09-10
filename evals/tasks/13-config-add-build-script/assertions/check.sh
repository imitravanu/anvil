#!/bin/bash
node -e '
const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
if (!pkg.scripts || pkg.scripts.build !== "tsc -p ." || pkg.scripts.lint !== "eslint .") process.exit(1);
console.log("PASS");
'
exit $?
