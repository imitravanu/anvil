"""Behaviour suite for src.cache.bounded_cache."""

import unittest

from src.cache import bounded_cache


class BoundedCacheTest(unittest.TestCase):
    def test_caches_repeated_calls(self):
        calls = []

        @bounded_cache(maxsize=4)
        def double(n):
            calls.append(n)
            return n * 2

        self.assertEqual(double(2), 4)
        self.assertEqual(double(2), 4)
        self.assertEqual(calls, [2])

    def test_evicts_least_recently_used(self):
        calls = []

        @bounded_cache(maxsize=2)
        def track(n):
            calls.append(n)
            return n * 2

        track(1)
        track(2)
        track(1)  # a hit, so 2 becomes the least recently used entry
        calls.clear()
        track(3)  # full: this must evict 2
        self.assertEqual(track(2), 4)
        self.assertEqual(calls, [3, 2])

    def test_evicts_oldest_when_maxsize_is_one(self):
        calls = []

        @bounded_cache(maxsize=1)
        def track(n):
            calls.append(n)
            return n

        track(1)
        track(2)
        self.assertEqual(track(1), 1)
        self.assertEqual(calls, [1, 2, 1])

    def test_preserves_function_metadata(self):
        @bounded_cache(maxsize=2)
        def documented(n):
            """Doubles n."""
            return n * 2

        self.assertEqual(documented.__name__, "documented")
        self.assertEqual(documented.__doc__, "Doubles n.")

    def test_rejects_non_positive_maxsize(self):
        with self.assertRaises(ValueError):
            bounded_cache(maxsize=0)


if __name__ == "__main__":
    unittest.main()
