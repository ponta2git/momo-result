from __future__ import annotations

from collections.abc import Callable

from momo_ocr.features.incident_log.attempts import CountRecognitionResult

SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD = 0.6
MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY = 2
SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD = 0.75
ONE_COUNT = 1
SEVEN_ALIAS_COUNT = 7

type RecoveryResult = tuple[int, float | None]
type RecoveryRule = Callable[
    [
        CountRecognitionResult,
        list[CountRecognitionResult],
        list[CountRecognitionResult],
        list[CountRecognitionResult],
        int,
    ],
    RecoveryResult | None,
]


def select_recovery(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    valid: list[CountRecognitionResult],
    plausible: list[CountRecognitionResult],
    max_plausible_count: int,
) -> RecoveryResult | None:
    for rule in _RECOVERY_RULES:
        recovered = rule(primary, fallback_results, valid, plausible, max_plausible_count)
        if recovered is not None:
            return recovered
    return None


def _leading_digit_rule(
    _primary: CountRecognitionResult,
    _fallback_results: list[CountRecognitionResult],
    valid: list[CountRecognitionResult],
    plausible: list[CountRecognitionResult],
    max_plausible_count: int,
) -> RecoveryResult | None:
    if plausible:
        return None
    return _recover_plausible_leading_digit(valid, max_plausible_count=max_plausible_count)


def _otsu_zero_alias_rule(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    _valid: list[CountRecognitionResult],
    _plausible: list[CountRecognitionResult],
    max_plausible_count: int,
) -> RecoveryResult | None:
    if len(fallback_results) < MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY:
        return None

    sharpened = fallback_results[0]
    otsu = fallback_results[1]
    should_recover = _is_zero_alias_conflict(
        primary,
        sharpened,
        otsu,
        max_plausible_count=max_plausible_count,
    )
    return (otsu.count, otsu.confidence) if should_recover and otsu.count is not None else None


def _otsu_one_from_seven_alias_rule(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    _valid: list[CountRecognitionResult],
    _plausible: list[CountRecognitionResult],
    max_plausible_count: int,
) -> RecoveryResult | None:
    if max_plausible_count < SEVEN_ALIAS_COUNT:
        return None
    if len(fallback_results) < MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY:
        return None

    sharpened = fallback_results[0]
    otsu = fallback_results[1]
    non_otsu = (primary, sharpened)
    seven_candidates = [result for result in non_otsu if result.count == SEVEN_ALIAS_COUNT]
    should_recover = _is_weak_seven_alias_conflict(
        otsu,
        seven_candidates=seven_candidates,
        non_otsu=non_otsu,
    )
    return (ONE_COUNT, otsu.confidence) if should_recover else None


def _is_zero_alias_conflict(
    primary: CountRecognitionResult,
    sharpened: CountRecognitionResult,
    otsu: CountRecognitionResult,
    *,
    max_plausible_count: int,
) -> bool:
    return (
        primary.count == 0
        and not _contains_digit(primary.raw_text)
        and _is_single_plausible_nonzero_digit(otsu, max_plausible_count)
        and _is_single_plausible_nonzero_digit(sharpened, max_plausible_count)
        and otsu.count != sharpened.count
        and (sharpened.confidence or 0.0) < SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD
    )


def _is_weak_seven_alias_conflict(
    otsu: CountRecognitionResult,
    *,
    seven_candidates: list[CountRecognitionResult],
    non_otsu: tuple[CountRecognitionResult, CountRecognitionResult],
) -> bool:
    if not _is_exact_single_digit(otsu, ONE_COUNT) or not seven_candidates:
        return False
    has_other_digit = any(
        result.count is not None and result.count != SEVEN_ALIAS_COUNT for result in non_otsu
    )
    seven_confidence = max((result.confidence or 0.0) for result in seven_candidates)
    return not has_other_digit and seven_confidence <= SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD


def _contains_digit(text: str) -> bool:
    return any(char.isdigit() for char in text)


def _is_exact_single_digit(result: CountRecognitionResult, count: int) -> bool:
    if result.count != count:
        return False
    return any(piece == str(count) for piece in _text_pieces(result.raw_text))


def _is_single_plausible_nonzero_digit(
    result: CountRecognitionResult,
    max_plausible_count: int,
) -> bool:
    if result.count is None or not 0 < result.count <= min(9, max_plausible_count):
        return False
    return any(piece == str(result.count) for piece in _text_pieces(result.raw_text))


def _recover_plausible_leading_digit(
    results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> RecoveryResult | None:
    candidates = [
        candidate
        for result in results
        if result.count is not None and result.count > max_plausible_count
        for candidate in [_leading_digit_candidate(result, max_plausible_count)]
        if candidate is not None
    ]
    digits = [digit for digit, _confidence in candidates]
    if not digits or len(set(digits)) != 1:
        return None
    confidences = [confidence for _digit, confidence in candidates if confidence is not None]
    return digits[0], max(confidences) if confidences else None


def _leading_digit_candidate(
    result: CountRecognitionResult,
    max_plausible_count: int,
) -> RecoveryResult | None:
    for piece in _text_pieces(result.raw_text):
        digits = "".join(ch for ch in piece if ch.isdigit())
        if len(digits) <= 1:
            continue
        leading = int(digits[0])
        if 0 < leading <= max_plausible_count:
            return leading, result.confidence
    return None


def _text_pieces(raw_text: str) -> list[str]:
    return [piece.strip() for piece in raw_text.split("|") if piece.strip()]


_RECOVERY_RULES: tuple[RecoveryRule, ...] = (
    _leading_digit_rule,
    _otsu_zero_alias_rule,
    _otsu_one_from_seven_alias_rule,
)
