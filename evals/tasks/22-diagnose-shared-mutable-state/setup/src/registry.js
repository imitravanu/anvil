const items = [];

function add(item) {
  items.push(item);
}

// BUG: this hands out the registry's own array, so every caller can observe
// (and mutate) later registrations through a snapshot it already holds.
function list() {
  return items;
}

function clear() {
  items.length = 0;
}

module.exports = { add, list, clear };
