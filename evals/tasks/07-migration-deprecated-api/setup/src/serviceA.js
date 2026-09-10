const logger = require("./logger.js");
function runA() {
  logger.warnLegacy("Service A started");
}
module.exports = { runA };
