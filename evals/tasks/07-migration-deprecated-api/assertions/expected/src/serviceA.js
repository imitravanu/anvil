const logger = require("./logger.js");
function runA() {
  logger.warn("Service A started");
}
module.exports = { runA };
