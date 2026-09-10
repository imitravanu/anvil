const { ROLES } = require("./constants.js");
function getRole() { return ROLES.USER; }
module.exports = { ROLES, getRole };
