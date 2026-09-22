"""Behaviour suite for the typed application config."""

import unittest
from dataclasses import FrozenInstanceError, is_dataclass

from src.config import Config, load_config


class ConfigTest(unittest.TestCase):
    def test_returns_a_dataclass(self):
        self.assertTrue(is_dataclass(load_config({})))

    def test_applies_defaults(self):
        config = load_config({})
        self.assertEqual(config.host, "localhost")
        self.assertEqual(config.port, 8080)
        self.assertFalse(config.debug)

    def test_reads_overrides(self):
        config = load_config({"host": "0.0.0.0", "port": "9000", "debug": True})
        self.assertEqual(config.host, "0.0.0.0")
        self.assertEqual(config.port, 9000)
        self.assertTrue(config.debug)

    def test_is_frozen(self):
        config = load_config({})
        with self.assertRaises(FrozenInstanceError):
            config.port = 1

    def test_rejects_unparsable_port(self):
        with self.assertRaises(ValueError):
            load_config({"port": "not-a-number"})

    def test_rejects_non_positive_port(self):
        with self.assertRaises(ValueError):
            load_config({"port": 0})

    def test_is_directly_constructible(self):
        config = Config(host="example.test", port=443)
        self.assertEqual(config.host, "example.test")
        self.assertEqual(config.port, 443)
        self.assertFalse(config.debug)


if __name__ == "__main__":
    unittest.main()
