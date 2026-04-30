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


_PIPE_NOISE_CHARS = frozenset("|｜Ili")


def parse_count(value: str) -> int | None:
    if value.strip() in {"|", "｜"}:
        return 1
    for candidate in reversed(value.split("|")):
        normalized = candidate.translate(_COUNT_ALIASES)
        digits = "".join(char for char in normalized if char.isdigit())
        if digits:
            # 先頭桁が "0" の多桁列は、罫線/区切り由来のノイズが後ろに付いたケースが
            # ほとんど (例: "03", "01", "O71" は実際にはセルが "0")。先頭桁を真値とする。
            if len(digits) > 1 and digits[0] == "0":
                return 0
            return int(digits)
    return None


def is_pure_pipe_noise(text: str) -> bool:
    """`|` / `｜` / `I` / `l` / `i` のみで構成された文字列か判定する。

    桃鉄の事件簿セルでは罫線が縦棒として誤認識されやすく、これらの文字列は
    confidence が低い場合に digit として扱うべきでない。
    """
    cleaned = text.strip()
    if not cleaned:
        return False
    return all(ch in _PIPE_NOISE_CHARS or ch.isspace() for ch in cleaned)
