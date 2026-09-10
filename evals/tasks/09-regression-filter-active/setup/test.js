const assert = require("node:assert");
const { getActiveUsers } = require("./src/users.js");

const list = [
  { id: 1, active: true, isDeleted: false },
  { id: 2, active: true, isDeleted: true },
  { id: 3, active: false, isDeleted: false }
];

const active = getActiveUsers(list);
assert.strictEqual(active.length, 1);
assert.strictEqual(active[0].id, 1);
console.log("PASS");
