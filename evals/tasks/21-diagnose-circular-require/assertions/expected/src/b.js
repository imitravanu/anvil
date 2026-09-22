const VERSION = "1.0.0";

function label() {
  // Resolved at call time rather than load time: when this module first loads,
  // `a` is still mid-initialization and its exports object is still empty.
  const { NAME } = require("./a");
  return `${NAME}-${VERSION}`;
}

module.exports = { VERSION, label };
