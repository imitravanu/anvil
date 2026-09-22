const { VERSION } = require("./b");

const NAME = "alpha";

function banner() {
  return `${NAME}@${VERSION}`;
}

module.exports = { NAME, banner };
