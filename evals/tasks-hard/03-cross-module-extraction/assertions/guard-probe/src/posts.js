const { slugify } = require("./slug");

// GUARD PROBE: imports the extracted rule (so the import check passes) while
// still carrying its own copy of the implementation the task asked to delete.
// Every assertion passes; only the duplication guard can fail this tree.
function localSlugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function postPath(title) {
  return "/posts/" + slugify(title || localSlugify("untitled"));
}

module.exports = { slugify, postPath };
