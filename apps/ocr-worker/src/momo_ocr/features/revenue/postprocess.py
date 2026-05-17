from __future__ import annotations

import re

from momo_ocr.features.ocr_domain.money import parse_man_yen as parse_money_man_yen

_ZERO_REVENUE_ALIAS_RE = re.compile(
    r"社長[^|\n]{0,20}(?:0|[oO])\s*(?:[fFnNmM][sS]?|[万円口幅])(?:\b|\s|$)"
)


def parse_man_yen(value: str) -> int | None:
    amount = parse_money_man_yen(value)
    if amount is not None:
        return amount
    if _ZERO_REVENUE_ALIAS_RE.search(value):
        return 0
    return None


__all__ = ["parse_man_yen"]
