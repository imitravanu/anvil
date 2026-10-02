// Pages a list. The caller counts pages to size its progress bar, so an
// off-by-one here is a real user-visible defect, not a cosmetic one.
function paginate(items, size) {
  const pages = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

module.exports = { paginate };
