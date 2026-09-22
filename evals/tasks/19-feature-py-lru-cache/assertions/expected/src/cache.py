"""Bounded caching decorator."""

from collections import OrderedDict
from functools import wraps


def bounded_cache(maxsize=128):
    """Decorate a function with an LRU cache holding at most `maxsize` entries."""
    if maxsize <= 0:
        raise ValueError("maxsize must be positive")

    def decorator(func):
        # OrderedDict keeps insertion order, so the oldest entry is always the
        # first key and a hit can be refreshed by moving its key to the end.
        cache = OrderedDict()

        @wraps(func)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            if key in cache:
                cache.move_to_end(key)
                return cache[key]

            result = func(*args, **kwargs)
            cache[key] = result
            if len(cache) > maxsize:
                cache.popitem(last=False)
            return result

        return wrapper

    return decorator
