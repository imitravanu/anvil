const logger = require("./logger.js");
function runC() {
  logger.warn("Service C warning");
}
module.exports = { runC };
