# Implement a bounded LRU decorator cache in Python

**Category:** feature

### Prompt
In src/cache.py, implement bounded_cache(maxsize=128) as a decorator that memoizes results in an LRU cache holding at most `maxsize` entries, evicting the least recently used entry when full. A cache hit must not call the wrapped function again, and a hit must refresh that entry's recency. Raise ValueError for a non-positive maxsize, and preserve the wrapped function's __name__ and __doc__. Assertions run `python3 -m unittest test_cache.py`.

### Assertion
`assertions/check.sh` runs the sandbox's `unittest` suite. Each test builds a
fresh decorated function, so the cache state is per-test and the eviction
assertions cannot pass by leaking state between cases.
