// Copy of the slug rule — the same five lines live in src/tags.js.
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function postPath(title) {
  return "/posts/" + slugify(title);
}

module.exports = { slugify, postPath };
