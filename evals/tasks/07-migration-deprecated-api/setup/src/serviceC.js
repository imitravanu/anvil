const logger = require("./logger.js");
function runC() {
  logger.warnLegacy("Service C warning");
}
module.exports = { runC };
