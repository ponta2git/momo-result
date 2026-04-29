from __future__ import annotations


def parse_man_yen(value: str) -> int | None:
    digits = "".join(char for char in value if char.isdigit() or char == "-")
    return int(digits) if digits else None
