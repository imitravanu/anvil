#!/bin/bash
node -e '
const cfg = JSON.parse(require("fs").readFileSync("config/app.json", "utf8"));
if (!cfg.server || cfg.server.port !== 8080 || cfg.server.host !== "localhost") process.exit(1);
if (cfg.port !== undefined || cfg.host !== undefined) process.exit(1);
console.log("PASS");
'
exit $?
