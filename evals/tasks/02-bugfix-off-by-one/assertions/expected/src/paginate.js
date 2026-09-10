function paginate(items, page, pageSize) {
  const startIndex = (page - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}
module.exports = { paginate };
