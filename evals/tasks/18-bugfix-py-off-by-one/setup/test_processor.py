"""Regression suite for src.processor.chunk."""

import unittest

from src.processor import chunk


class ChunkTest(unittest.TestCase):
    def test_exact_division(self):
        self.assertEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])

    def test_trailing_remainder_is_kept(self):
        self.assertEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

    def test_size_larger_than_input(self):
        self.assertEqual(chunk([1, 2], 5), [[1, 2]])

    def test_empty_input(self):
        self.assertEqual(chunk([], 3), [])

    def test_rejects_non_positive_size(self):
        with self.assertRaises(ValueError):
            chunk([1, 2, 3], 0)


if __name__ == "__main__":
    unittest.main()
