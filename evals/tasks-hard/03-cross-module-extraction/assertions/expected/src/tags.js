const { slugify } = require("./slug");

function tagPath(tag) {
  return "/tags/" + slugify(tag);
}

module.exports = { slugify, tagPath };
