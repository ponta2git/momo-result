from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

# Negative-sign character class: ASCII hyphen-minus, U+2212 minus, U+30FC katakana
# prolonged sound mark (ー), U+4E00 ideographic one (一), en/em dashes, and
# U+2010 hyphen. Tesseract frequently confuses the in-game minus glyph with
# ー or 一 because they share the same horizontal-stroke shape, which causes
# revenue values like "-2万円" to be parsed as positive without this list.
# To avoid swallowing the trailing ー of player names like "おーたか" or
# "いーゆー", the sign character must not be preceded by a letter
# (kana/CJK/latin). It is allowed at start-of-string or after whitespace,
# digits, or punctuation.
_MINUS_SIGN_CHARS = "-−ー一–—‐"
_MINUS_LOOKBEHIND = r"(?<![ぁ-んァ-ヴ一-龥A-Za-z])"
MONEY_TEXT_RE = re.compile(
    _MINUS_LOOKBEHIND + r"[" + _MINUS_SIGN_CHARS + r"]?\s*"
    r"(?:(?:\d+\s*億\s*)?(?:\d+\s*万\s*)|\d+\s*億\s*|\d+\s*)[円口幅]"
)
DIGIT_FALLBACK_RE = re.compile(r"(?<!\d)(\d{5,8})(?!\d)")
LONG_DIGIT_FALLBACK_LENGTH = 7

# Tesseract often misreads 億/円 unit characters when they share a row with noisy
# game UI. Substitute only when the confused character is digit-adjacent so
# unrelated kanji (e.g. 借金, 信号, 出口) outside money expressions are not
# corrupted. This bounded normalization protects names and labels that may live
# in the same OCR snippet.
_OKU_CONFUSIONS = ("借", "信", "僧")
_YEN_CONFUSIONS = ("口", "幅")
_OKU_CONFUSION_RE = re.compile(
    r"(?<=\d)\s*(" + "|".join(_OKU_CONFUSIONS) + r")\s*(?=\d)",
)
_YEN_CONFUSION_RE = re.compile(
    r"(?<=\d)\s*(" + "|".join(_YEN_CONFUSIONS) + r")(?=\s|$|\W)",
)


@dataclass(frozen=True)
class MoneyCandidate:
    amount_man_yen: int
    score: int


def parse_man_yen(value: str) -> int | None:
    normalized = _normalize_units(value).replace(",", "").replace("，", "")
    candidates = _unit_candidates(normalized)
    if not any(candidate.amount_man_yen != 0 for candidate in candidates):
        candidates.extend(_digit_fallback_candidates(normalized))
    if not candidates:
        return None
    return _select_candidate(candidates)


def _normalize_units(value: str) -> str:
    normalized = _OKU_CONFUSION_RE.sub("億", value)
    return _YEN_CONFUSION_RE.sub("円", normalized)


def _unit_candidates(value: str) -> list[MoneyCandidate]:
    candidates: list[MoneyCandidate] = []
    for match in MONEY_TEXT_RE.finditer(value):
        amount_text = match.group(0)
        sign = -1 if amount_text.lstrip().startswith(tuple(_MINUS_SIGN_CHARS)) else 1
        oku_match = re.search(r"(\d+)\s*億", amount_text)
        man_match = re.search(r"(\d+)\s*万", amount_text)
        digits = "".join(char for char in amount_text if char.isdigit())
        if oku_match is not None and man_match is not None:
            candidates.append(
                MoneyCandidate(
                    amount_man_yen=sign
                    * (int(oku_match.group(1)) * 10000 + int(man_match.group(1))),
                    score=4,
                )
            )
        elif oku_match is not None:
            candidates.append(
                MoneyCandidate(amount_man_yen=sign * int(oku_match.group(1)) * 10000, score=3)
            )
        elif man_match is not None:
            candidates.append(
                MoneyCandidate(amount_man_yen=sign * int(man_match.group(1)), score=2)
            )
        elif digits:
            candidates.append(MoneyCandidate(amount_man_yen=sign * int(digits), score=1))
    return candidates


def _digit_fallback_candidates(value: str) -> list[MoneyCandidate]:
    candidates: list[MoneyCandidate] = []
    for match in DIGIT_FALLBACK_RE.finditer(value):
        digits = match.group(1)
        if len(digits) >= LONG_DIGIT_FALLBACK_LENGTH:
            candidates.append(MoneyCandidate(amount_man_yen=int(digits[:-2]), score=0))
        else:
            candidates.append(MoneyCandidate(amount_man_yen=int(digits[:-1]), score=0))
    return candidates


def _select_candidate(candidates: list[MoneyCandidate]) -> int:
    selectable_candidates = [
        candidate for candidate in candidates if candidate.amount_man_yen != 0
    ] or candidates
    amount_counts = Counter(candidate.amount_man_yen for candidate in selectable_candidates)
    best_amount, _ = max(
        amount_counts.items(),
        key=lambda item: (
            item[1],
            max(
                candidate.score
                for candidate in selectable_candidates
                if candidate.amount_man_yen == item[0]
            ),
        ),
    )
    return best_amount
