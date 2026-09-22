const items = [];

function add(item) {
  items.push(item);
}

function list() {
  // A copy, so a caller holding a snapshot can neither observe later
  // registrations nor mutate the registry's internal array.
  return items.slice();
}

function clear() {
  items.length = 0;
}

module.exports = { add, list, clear };
