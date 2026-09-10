const logger = require("./logger.js");
function runB() {
  logger.warn("Service B warning");
}
module.exports = { runB };
