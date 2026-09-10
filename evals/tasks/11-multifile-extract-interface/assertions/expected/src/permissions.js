const { ROLES } = require("./constants.js");
function canEdit(role) {
  return role === ROLES.ADMIN;
}
module.exports = { canEdit };
