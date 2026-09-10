#!/bin/bash
node -e '
const { ROLES } = require("./src/constants.js");
const auth = require("./src/auth.js");
const perms = require("./src/permissions.js");
if (!ROLES || ROLES.ADMIN !== "admin") process.exit(1);
if (auth.getRole() !== "user") process.exit(1);
console.log("PASS");
'
exit $?
