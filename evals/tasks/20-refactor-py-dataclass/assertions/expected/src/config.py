"""Application configuration loading."""

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class Config:
    """Normalized application configuration."""

    host: str = "localhost"
    port: int = 8080
    debug: bool = False

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "Config":
        """Build a Config from a raw mapping, applying defaults and coercion."""
        port = raw.get("port", 8080)
        try:
            normalized_port = int(port)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"port must be an integer, got {port!r}") from exc
        if normalized_port <= 0:
            raise ValueError(f"port must be positive, got {normalized_port}")

        return cls(
            host=str(raw.get("host", "localhost")),
            port=normalized_port,
            debug=bool(raw.get("debug", False)),
        )


def load_config(raw):
    """Return the normalized application configuration as a frozen Config."""
    return Config.from_mapping(raw)
