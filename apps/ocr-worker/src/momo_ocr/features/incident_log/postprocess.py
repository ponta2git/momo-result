from __future__ import annotations


def parse_count(value: str) -> int | None:
    digits = "".join(char for char in value if char.isdigit())
    return int(digits) if digits else None
