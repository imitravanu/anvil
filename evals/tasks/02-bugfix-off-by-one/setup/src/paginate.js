function paginate(items, page, pageSize) {
  const startIndex = page * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}
module.exports = { paginate };
