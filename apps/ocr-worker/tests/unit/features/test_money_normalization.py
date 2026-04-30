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


def test_parse_man_yen_handles_ocr_minus_sign_confusions() -> None:
    # Tesseract frequently confuses the in-game minus glyph with ー (U+30FC),
    # 一 (U+4E00), or other dashes. Without this normalization, revenue rows
    # like "ー2万円" (originally "-2万円") parse as positive +2.
    assert parse_man_yen("-2万円") == -2
    assert parse_man_yen("−2万円") == -2  # U+2212
    assert parse_man_yen("ー2万円") == -2  # U+30FC
    assert parse_man_yen("一2万円") == -2  # U+4E00
    assert parse_man_yen("–2万円") == -2  # U+2013 en dash
    assert parse_man_yen("—2万円") == -2  # U+2014 em dash
    assert parse_man_yen("‐2万円") == -2  # U+2010 hyphen
    # Also works with 億+万 expressions.
    assert parse_man_yen("ー1億2000万円") == -12000


def test_parse_man_yen_does_not_treat_player_name_dash_as_minus() -> None:
    # Names like "おーたか", "いーゆー" contain ー as a long-vowel mark.
    # When followed by digits without a separator, the ー must NOT be
    # interpreted as a minus sign. The lookbehind guard rejects sign chars
    # that immediately follow a kana/CJK letter.
    assert parse_man_yen("おーたか社長 25万円") == 25
    assert parse_man_yen("いーゆー社長 2190万円") == 2190
    # Even when the trailing ー is glued directly to digits.
    assert parse_man_yen("おたかー25万円") == 25
