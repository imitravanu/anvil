function chunk(array, size) {
  if (!Array.isArray(array) || array.length === 0) return [];
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
module.exports = { chunk };
