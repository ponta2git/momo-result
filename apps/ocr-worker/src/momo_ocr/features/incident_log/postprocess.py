from __future__ import annotations

_COUNT_ALIASES = str.maketrans(
    {
        "Ｏ": "0",
        "O": "0",
        "o": "0",
        "ｏ": "0",
        "I": "1",
        "l": "1",
        "i": "1",
        "|": "1",
        "｜": "1",
    }
)


def parse_count(value: str) -> int | None:
    if value.strip() in {"|", "｜"}:
        return 1
    for candidate in reversed(value.split("|")):
        normalized = candidate.translate(_COUNT_ALIASES)
        digits = "".join(char for char in normalized if char.isdigit())
        if digits:
            return int(digits)
    return None
