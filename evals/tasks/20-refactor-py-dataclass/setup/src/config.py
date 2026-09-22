"""Application configuration loading."""


def load_config(raw):
    """Return the normalized application configuration."""
    return {
        "host": raw.get("host", "localhost"),
        "port": int(raw.get("port", 8080)),
        "debug": bool(raw.get("debug", False)),
    }
