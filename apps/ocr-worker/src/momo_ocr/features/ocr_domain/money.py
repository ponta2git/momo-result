from __future__ import annotations

import re

MONEY_TEXT_RE = re.compile(r"[-−]?\s*(?:\d+\s*億)?\s*\d+\s*(?:万\s*)?[円口]")


def parse_man_yen(value: str) -> int | None:
    normalized = value.replace(",", "").replace("，", "")
    match = MONEY_TEXT_RE.search(normalized)
    if match is not None:
        amount_text = match.group(0)
        sign = -1 if amount_text.lstrip().startswith(("-", "−")) else 1
        oku_match = re.search(r"(\d+)\s*億", amount_text)
        man_match = re.search(r"(\d+)\s*万", amount_text)
        if man_match is not None:
            oku = int(oku_match.group(1)) if oku_match is not None else 0
            man = int(man_match.group(1))
            return sign * (oku * 10000 + man)
        digits = "".join(char for char in amount_text if char.isdigit())
        if digits:
            return sign * int(digits)

    return None
