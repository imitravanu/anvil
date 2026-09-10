function sortByPriority(items) {
  return [...items].sort((a, b) => b.priority - a.priority);
}
module.exports = { sortByPriority };
