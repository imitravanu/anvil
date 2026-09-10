function sortByPriority(items) {
  // Bug: sorted ascending
  return [...items].sort((a, b) => a.priority - b.priority);
}
module.exports = { sortByPriority };
