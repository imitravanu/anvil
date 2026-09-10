const logger = require("./logger.js");
function runB() {
  logger.warnLegacy("Service B warning");
}
module.exports = { runB };
