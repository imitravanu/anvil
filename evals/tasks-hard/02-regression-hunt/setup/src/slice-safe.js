// Slices a window out of a list. Written for the streaming reader, which always
// asks for a window at or after the cursor.
function safeSlice(items, start, size) {
  // Clamps against the last index so a window never runs past the end.
  const end = Math.min(start + size, items.length - 1);
  return items.slice(start, end);
}

module.exports = { safeSlice };
