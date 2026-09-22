const { NAME } = require("./a");

// BUG: `a` is still initializing when this line runs, so its exports object is
// still empty and NAME is undefined here.
const PREFIX = NAME.toUpperCase();

const VERSION = "1.0.0";

function label() {
  return `${PREFIX}-${VERSION}`;
}

module.exports = { VERSION, label };
