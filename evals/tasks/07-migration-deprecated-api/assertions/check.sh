#!/bin/bash
if grep -r "warnLegacy" src/; then
  echo "FAIL: deprecated warnLegacy still present"
  exit 1
fi
node -e 'require("./src/serviceA.js").runA(); require("./src/serviceB.js").runB(); require("./src/serviceC.js").runC();'
echo "PASS"
exit 0
