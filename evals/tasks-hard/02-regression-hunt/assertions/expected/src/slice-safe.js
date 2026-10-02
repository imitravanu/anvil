// Slices a window out of a list. Written for the streaming reader, which always
// asks for a window at or after the cursor.
function safeSlice(items, start, size) {
  const end = Math.min(start + size, items.length);
  return items.slice(start, end);
}

module.exports = { safeSlice };
