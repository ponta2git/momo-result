"""Tests for bounded money unit substitutions (Fix B).

The previous implementation translated every ``信/借/僧`` to ``億`` and
``口/幅`` to ``円``. That corrupted unrelated kanji in player rows
(``借金``, ``出口``, etc.). The current implementation only substitutes
when the confused character is digit-adjacent.
"""

from __future__ import annotations

from momo_ocr.features.ocr_domain.money import parse_man_yen


def test_parse_man_yen_does_not_corrupt_non_money_kanji() -> None:
    # ``借`` here is part of ``借金`` in surrounding noise, not a unit
    # substitution for ``億``. Bounded substitution must leave the digits
    # intact and let the regular parser fall back to digit detection.
    assert parse_man_yen("借金 100円") == 100


def test_parse_man_yen_still_normalizes_digit_adjacent_oku_confusions() -> None:
    assert parse_man_yen("2借3100万円") == 23100
    assert parse_man_yen("3信8920万円") == 38920
    assert parse_man_yen("4僧2000万円") == 42000


def test_parse_man_yen_still_normalizes_digit_adjacent_yen_confusions() -> None:
    assert parse_man_yen("2190万口") == 2190
    assert parse_man_yen("3500万幅") == 3500
