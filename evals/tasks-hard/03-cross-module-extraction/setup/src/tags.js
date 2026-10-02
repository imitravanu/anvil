// Copy of the slug rule — the same five lines live in src/posts.js.
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tagPath(tag) {
  return "/tags/" + slugify(tag);
}

module.exports = { slugify, tagPath };
