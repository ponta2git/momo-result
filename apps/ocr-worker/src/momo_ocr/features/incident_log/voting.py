"""Pure voting and plausibility helpers for incident-log count recognition."""

from __future__ import annotations

from collections.abc import Iterable

from momo_ocr.features.incident_log import voting_recovery
from momo_ocr.features.incident_log.attempts import CountRecognitionResult, PsmAttempt
from momo_ocr.features.incident_log.voting_recovery import select_recovery
from momo_ocr.features.ocr_domain.models import OcrField, OcrWarning, WarningCode

GINJI_INCIDENT_NAME = "スリの銀次"
MAX_PLAUSIBLE_STOP_COUNT = 12
MAX_PLAUSIBLE_STOP_TOTAL = 14
MAX_PLAUSIBLE_GINJI_TOTAL = 2
SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD = voting_recovery.SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD
MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY = voting_recovery.MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY
SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD = voting_recovery.SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD
ONE_COUNT = voting_recovery.ONE_COUNT
SEVEN_ALIAS_COUNT = voting_recovery.SEVEN_ALIAS_COUNT


def max_plausible_cell_count(incident_name: str) -> int:
    if incident_name == GINJI_INCIDENT_NAME:
        return MAX_PLAUSIBLE_GINJI_TOTAL
    return MAX_PLAUSIBLE_STOP_COUNT


def vote_count(attempts: list[PsmAttempt]) -> tuple[int | None, float | None]:
    valid = [attempt for attempt in attempts if attempt.count is not None]
    if not valid:
        return None, None

    chosen_count, chosen_group = min(
        _attempt_groups(valid).items(),
        key=_attempt_sort_key,
    )
    return chosen_count, _max_confidence(attempt.confidence for attempt in chosen_group)


def select_count_recognition(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> CountRecognitionResult:
    candidates = [primary, *fallback_results]
    raw_text = _combined_raw_text(candidates)
    valid = [result for result in candidates if result.count is not None]
    if not valid:
        return _recognition(raw_text, count=None, confidence=None)

    plausible = _plausible_results(valid, max_plausible_count)
    recovered = select_recovery(
        primary,
        fallback_results,
        valid=valid,
        plausible=plausible,
        max_plausible_count=max_plausible_count,
    )
    if recovered is not None:
        count, confidence = recovered
        return _recognition(raw_text, count=count, confidence=confidence)

    pool = plausible or valid
    chosen_count, chosen_group = min(
        _recognition_groups(pool).items(),
        key=_recognition_sort_key,
    )
    return _recognition(
        raw_text,
        count=chosen_count,
        confidence=_attenuated_confidence(chosen_group, pool_size=len(pool)),
    )


def plausibility_warnings(
    player_counts: list[dict[str, OcrField[int]]],
) -> list[OcrWarning]:
    """Emit warnings for individually high counts and per-player totals."""
    warnings: list[OcrWarning] = []
    ginji_total = 0
    for player_index, counts in enumerate(player_counts):
        station_total, station_warnings = _station_total_warnings(player_index, counts)
        ginji_total += counts.get(GINJI_INCIDENT_NAME, OcrField[int](value=0)).value or 0
        warnings.extend(station_warnings)
        if station_total > MAX_PLAUSIBLE_STOP_TOTAL:
            warnings.append(
                _suspicious_count_warning(
                    field_path=f"players[{player_index}].incidents",
                    message=(
                        f"Incident station-stop total for player column {player_index + 1} "
                        f"is {station_total}, which is high for a 12-turn game."
                    ),
                )
            )
    if ginji_total > MAX_PLAUSIBLE_GINJI_TOTAL:
        warnings.append(
            _suspicious_count_warning(
                field_path="players[].incidents['スリの銀次']",
                message=(f"スリの銀次 total is {ginji_total}, which is high for one 12-turn game."),
            )
        )
    return warnings


def _attempt_groups(attempts: Iterable[PsmAttempt]) -> dict[int, list[PsmAttempt]]:
    grouped: dict[int, list[PsmAttempt]] = {}
    for attempt in attempts:
        if attempt.count is not None:
            grouped.setdefault(attempt.count, []).append(attempt)
    return grouped


def _recognition_groups(
    results: Iterable[CountRecognitionResult],
) -> dict[int, list[CountRecognitionResult]]:
    grouped: dict[int, list[CountRecognitionResult]] = {}
    for result in results:
        if result.count is not None:
            grouped.setdefault(result.count, []).append(result)
    return grouped


def _attempt_sort_key(item: tuple[int, list[PsmAttempt]]) -> tuple[int, int, float, int, int]:
    count, group = item
    return (
        -int(any(any(c.isdigit() for c in attempt.text) for attempt in group)),
        -len(group),
        -max((attempt.confidence or 0.0) for attempt in group),
        min(len(attempt.text) for attempt in group),
        count,
    )


def _recognition_sort_key(
    item: tuple[int, list[CountRecognitionResult]],
) -> tuple[int, int, float, int, int]:
    count, group = item
    return (
        -int(any(_has_digit_piece(result.raw_text) for result in group)),
        -len(group),
        -max((result.confidence or 0.0) for result in group),
        min(_min_piece_length(result.raw_text) for result in group),
        count,
    )


def _plausible_results(
    valid: Iterable[CountRecognitionResult],
    max_plausible_count: int,
) -> list[CountRecognitionResult]:
    return [
        result
        for result in valid
        if result.count is not None and result.count <= max_plausible_count
    ]


def _attenuated_confidence(
    chosen_group: list[CountRecognitionResult],
    *,
    pool_size: int,
) -> float | None:
    base_confidence = _max_confidence(result.confidence for result in chosen_group)
    if base_confidence is None:
        return None
    agreement_factor = len(chosen_group) / max(pool_size, 1)
    return base_confidence * (0.5 + 0.5 * agreement_factor)


def _max_confidence(confidences: Iterable[float | None]) -> float | None:
    present = [confidence for confidence in confidences if confidence is not None]
    return max(present) if present else None


def _combined_raw_text(candidates: Iterable[CountRecognitionResult]) -> str:
    snippets = [result.raw_text for result in candidates if result.raw_text]
    return " | ".join(dict.fromkeys(snippets))


def _recognition(
    raw_text: str,
    *,
    count: int | None,
    confidence: float | None,
) -> CountRecognitionResult:
    return CountRecognitionResult(raw_text=raw_text, count=count, confidence=confidence)


def _text_pieces(raw_text: str) -> list[str]:
    return [piece.strip() for piece in raw_text.split("|") if piece.strip()]


def _has_digit_piece(raw_text: str) -> bool:
    return any(any(char.isdigit() for char in piece) for piece in _text_pieces(raw_text))


def _min_piece_length(raw_text: str) -> int:
    pieces = _text_pieces(raw_text)
    if not pieces:
        return len(raw_text)
    return min(len(piece) for piece in pieces)


def _station_total_warnings(
    player_index: int,
    counts: dict[str, OcrField[int]],
) -> tuple[int, list[OcrWarning]]:
    total = 0
    warnings: list[OcrWarning] = []
    for incident_name, field in counts.items():
        if field.value is None or incident_name == GINJI_INCIDENT_NAME:
            continue
        total += field.value
        if field.value > MAX_PLAUSIBLE_STOP_COUNT:
            warnings.append(
                _suspicious_count_warning(
                    field_path=f"players[{player_index}].incidents[{incident_name!r}]",
                    message=(
                        f"{incident_name} count for player column {player_index + 1} "
                        f"is {field.value}, which is high for a 12-turn game."
                    ),
                )
            )
    return total, warnings


def _suspicious_count_warning(*, field_path: str, message: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.SUSPICIOUS_INCIDENT_COUNT,
        message=message,
        field_path=field_path,
    )
