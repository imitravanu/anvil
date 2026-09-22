# Migrate raw dictionary config to a typed dataclass in Python

**Category:** migration

### Prompt
Refactor src/config.py: load_config(raw) must return a frozen @dataclass Config (fields host: str, port: int, debug: bool) instead of a plain dict. Defaults are host "localhost", port 8080, debug False. Add a Config.from_mapping(raw) classmethod that coerces port with int() and raises ValueError when the port cannot be parsed as an integer or is not positive. Assertions run `python3 -m unittest test_config.py`.

### Assertion
`assertions/check.sh` runs the sandbox's `unittest` suite, which asserts the
return value is a dataclass, that defaults and overrides resolve, that the
instance is frozen, and that both invalid-port paths raise `ValueError`.
