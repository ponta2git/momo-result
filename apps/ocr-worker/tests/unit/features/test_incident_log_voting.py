"""Unit tests for incident-log voting and plausibility helpers."""

from __future__ import annotations

from momo_ocr.features.incident_log.attempts import CountRecognitionResult, PsmAttempt
from momo_ocr.features.incident_log.voting import (
    GINJI_INCIDENT_NAME,
    MAX_PLAUSIBLE_GINJI_TOTAL,
    MAX_PLAUSIBLE_STOP_COUNT,
    max_plausible_cell_count,
    plausibility_warnings,
    select_count_recognition,
    vote_count,
)
from momo_ocr.features.ocr_domain.models import OcrField, WarningCode


def _attempt(text: str, count: int | None, confidence: float | None) -> PsmAttempt:
    return PsmAttempt(text=text, count=count, confidence=confidence)


def test_vote_count_returns_none_when_no_valid_attempt() -> None:
    assert vote_count([_attempt("?", None, 0.9)]) == (None, None)


def test_vote_count_prefers_text_with_literal_digit() -> None:
    # "oo"→0 alias は has_digit=False. "3" は has_digit=True. confidence は不利でも勝つ。
    attempts = [
        _attempt("oo", 0, 0.05),
        _attempt("oo", 0, 0.05),
        _attempt("3", 3, 0.0),
    ]
    chosen, confidence = vote_count(attempts)
    assert chosen == 3
    assert confidence == 0.0


def test_vote_count_majority_wins_when_digit_parity() -> None:
    attempts = [
        _attempt("3", 3, 0.5),
        _attempt("3", 3, 0.6),
        _attempt("4", 4, 0.9),
    ]
    chosen, confidence = vote_count(attempts)
    assert chosen == 3
    assert confidence == 0.6


def test_select_count_recognition_prefers_plausible() -> None:
    primary = CountRecognitionResult(raw_text="13", count=13, confidence=0.9)
    fallback_a = CountRecognitionResult(raw_text="3", count=3, confidence=0.6)
    fallback_b = CountRecognitionResult(raw_text="3", count=3, confidence=0.6)
    selected = select_count_recognition(
        primary,
        [fallback_a, fallback_b],
        max_plausible_count=MAX_PLAUSIBLE_STOP_COUNT,
    )
    assert selected.count == 3


def test_select_count_recognition_falls_back_when_no_plausible() -> None:
    # max_plausible_count=2 (Ginji) なので 3/4/5 はすべて implausible。
    # その場合は valid pool 全件で投票する。
    primary = CountRecognitionResult(raw_text="5", count=5, confidence=0.7)
    fallback = CountRecognitionResult(raw_text="5", count=5, confidence=0.5)
    selected = select_count_recognition(
        primary, [fallback], max_plausible_count=MAX_PLAUSIBLE_GINJI_TOTAL
    )
    assert selected.count == 5


def test_select_count_recognition_recovers_common_leading_digit_from_overread() -> None:
    primary = CountRecognitionResult(raw_text="31", count=31, confidence=0.0)
    fallback = CountRecognitionResult(raw_text="35", count=35, confidence=0.28)
    selected = select_count_recognition(
        primary, [fallback], max_plausible_count=MAX_PLAUSIBLE_STOP_COUNT
    )
    assert selected.count == 3


def test_select_count_recognition_uses_count_tie_breaker_for_single_vote_digits() -> None:
    primary = CountRecognitionResult(raw_text="oi", count=0, confidence=0.0)
    fallback_a = CountRecognitionResult(raw_text="6", count=6, confidence=0.0)
    fallback_b = CountRecognitionResult(raw_text="3", count=3, confidence=0.0)
    selected = select_count_recognition(
        primary,
        [fallback_a, fallback_b],
        max_plausible_count=MAX_PLAUSIBLE_STOP_COUNT,
    )
    assert selected.count == 3


def test_select_count_recognition_attenuates_confidence_by_agreement() -> None:
    # 1 票だけ → agreement=1/3, confidence factor = 0.5 + 0.5/3 ≈ 0.667
    primary = CountRecognitionResult(raw_text="3", count=3, confidence=1.0)
    fb_a = CountRecognitionResult(raw_text="4", count=4, confidence=0.5)
    fb_b = CountRecognitionResult(raw_text="5", count=5, confidence=0.4)
    selected = select_count_recognition(
        primary, [fb_a, fb_b], max_plausible_count=MAX_PLAUSIBLE_STOP_COUNT
    )
    # primary が has_digit && plausible のため勝つが、confidence は減衰する。
    assert selected.count == 3
    assert selected.confidence is not None
    assert selected.confidence < 1.0


def test_plausibility_warnings_flags_high_individual_count() -> None:
    counts = [
        {
            "ふっとばし": OcrField[int](value=MAX_PLAUSIBLE_STOP_COUNT + 1),
            GINJI_INCIDENT_NAME: OcrField[int](value=0),
        },
        {"ふっとばし": OcrField[int](value=0), GINJI_INCIDENT_NAME: OcrField[int](value=0)},
    ]
    warnings = plausibility_warnings(counts)
    codes = [w.code for w in warnings]
    assert WarningCode.SUSPICIOUS_INCIDENT_COUNT in codes


def test_plausibility_warnings_flags_high_ginji_total() -> None:
    counts = [
        {GINJI_INCIDENT_NAME: OcrField[int](value=MAX_PLAUSIBLE_GINJI_TOTAL + 1)},
    ]
    warnings = plausibility_warnings(counts)
    assert any("スリの銀次" in (w.field_path or "") for w in warnings)


def test_max_plausible_cell_count_distinguishes_ginji() -> None:
    assert max_plausible_cell_count(GINJI_INCIDENT_NAME) == MAX_PLAUSIBLE_GINJI_TOTAL
    assert max_plausible_cell_count("ふっとばし") == MAX_PLAUSIBLE_STOP_COUNT
