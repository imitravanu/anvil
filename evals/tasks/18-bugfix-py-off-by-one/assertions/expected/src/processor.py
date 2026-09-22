"""Chunking helpers for the data processor."""


def chunk(items, size):
    """Split `items` into consecutive lists of at most `size` elements."""
    if size <= 0:
        raise ValueError("size must be positive")

    chunks = []
    for start in range(0, len(items), size):
        chunks.append(list(items[start:start + size]))
    return chunks
