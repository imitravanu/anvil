const { slugify } = require("./slug");

function postPath(title) {
  return "/posts/" + slugify(title);
}

module.exports = { slugify, postPath };
