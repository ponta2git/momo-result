"""Pure voting and plausibility helpers for incident-log count recognition.

Everything in this module is side-effect free: no IO, no engine calls,
no clock reads. This makes voting trivial to unit-test and lets us keep
the orchestration layer focused on assembly.
"""

from __future__ import annotations

from momo_ocr.features.incident_log.attempts import CountRecognitionResult, PsmAttempt
from momo_ocr.features.ocr_domain.models import OcrField, OcrWarning, WarningCode

GINJI_INCIDENT_NAME = "スリの銀次"
MAX_PLAUSIBLE_STOP_COUNT = 12
MAX_PLAUSIBLE_STOP_TOTAL = 14
MAX_PLAUSIBLE_GINJI_TOTAL = 2
SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD = 0.6
MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY = 2
SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD = 0.75
ONE_COUNT = 1
SEVEN_ALIAS_COUNT = 7


def max_plausible_cell_count(incident_name: str) -> int:
    if incident_name == GINJI_INCIDENT_NAME:
        return MAX_PLAUSIBLE_GINJI_TOTAL
    return MAX_PLAUSIBLE_STOP_COUNT


def vote_count(attempts: list[PsmAttempt]) -> tuple[int | None, float | None]:
    """Return the chosen ``(count, confidence)`` from PSM attempts.

    Same count groups vote together; ties break on (has_digit, votes,
    max_conf, min_text_len). Tesseract often returns confidence=0 for
    short legitimate digit reads while letter-aliased reads (``"oo"``)
    score slightly higher, so we gate on whether the text actually
    contained a digit before falling back to confidence.
    """
    valid = [attempt for attempt in attempts if attempt.count is not None]
    if not valid:
        return None, None

    by_count: dict[int, list[PsmAttempt]] = {}
    for attempt in valid:
        if attempt.count is None:
            continue
        by_count.setdefault(attempt.count, []).append(attempt)

    def sort_key(item: tuple[int, list[PsmAttempt]]) -> tuple[int, int, float, int, int]:
        count, group = item
        votes = len(group)
        min_text_len = min(len(attempt.text) for attempt in group)
        max_conf = max((attempt.confidence or 0.0) for attempt in group)
        has_any_digit = int(any(any(c.isdigit() for c in attempt.text) for attempt in group))
        return (-has_any_digit, -votes, -max_conf, min_text_len, count)

    chosen_count, chosen_group = min(by_count.items(), key=sort_key)
    confidences = [attempt.confidence for attempt in chosen_group if attempt.confidence is not None]
    chosen_confidence = max(confidences) if confidences else None
    return chosen_count, chosen_confidence


def select_count_recognition(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> CountRecognitionResult:
    """Combine primary + fallback variants into a single recognition.

    Plausible counts (≤ ``max_plausible_count``) are preferred; ties
    break on (has_digit, votes, max_conf, min_text_len). Confidence is
    attenuated by the agreement factor so a unanimous read is more
    confident than a single-vote read.
    """
    candidates = (primary, *fallback_results)
    snippets = [result.raw_text for result in candidates if result.raw_text]
    raw_text = " | ".join(dict.fromkeys(snippets))
    valid = [result for result in candidates if result.count is not None]
    if not valid:
        return _recognition(raw_text, count=None, confidence=None)

    plausible = [
        result
        for result in valid
        if result.count is not None and result.count <= max_plausible_count
    ]
    recovered = _select_recovery(
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
    by_count: dict[int, list[CountRecognitionResult]] = {}
    for result in pool:
        if result.count is None:
            continue
        by_count.setdefault(result.count, []).append(result)

    def sort_key(
        item: tuple[int, list[CountRecognitionResult]],
    ) -> tuple[int, int, float, int, int]:
        count, group = item
        votes = len(group)
        # raw_text may concatenate multiple PSM snippets via " | "; pick
        # the shortest pipe-separated piece so that noise-bloated reads
        # don't artificially inflate min_text_len.
        min_text_len = min(
            min(
                (len(piece.strip()) for piece in result.raw_text.split("|") if piece.strip()),
                default=len(result.raw_text),
            )
            for result in group
        )
        max_conf = max((result.confidence or 0.0) for result in group)
        has_any_digit = int(
            any(
                any(c.isdigit() for c in piece)
                for result in group
                for piece in result.raw_text.split("|")
            )
        )
        return (-has_any_digit, -votes, -max_conf, min_text_len, count)

    chosen_count, chosen_group = min(by_count.items(), key=sort_key)
    confidences = [result.confidence for result in chosen_group if result.confidence is not None]
    base_confidence = max(confidences) if confidences else None
    agreement_factor = len(chosen_group) / max(len(pool), 1)
    final_confidence = (
        base_confidence * (0.5 + 0.5 * agreement_factor) if base_confidence is not None else None
    )
    return _recognition(raw_text, count=chosen_count, confidence=final_confidence)


def _recognition(
    raw_text: str,
    *,
    count: int | None,
    confidence: float | None,
) -> CountRecognitionResult:
    return CountRecognitionResult(raw_text=raw_text, count=count, confidence=confidence)


def _select_recovery(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    valid: list[CountRecognitionResult],
    plausible: list[CountRecognitionResult],
    max_plausible_count: int,
) -> tuple[int, float | None] | None:
    recovered = None
    leading = _recover_plausible_leading_digit(valid, max_plausible_count=max_plausible_count)
    if not plausible and leading is not None:
        recovered = leading
    if recovered is None:
        recovered = _recover_otsu_digit_from_zero_alias_conflict(
            primary,
            fallback_results,
            max_plausible_count=max_plausible_count,
        )
    if recovered is None:
        recovered = _recover_otsu_one_from_seven_alias_conflict(
            primary,
            fallback_results,
            max_plausible_count=max_plausible_count,
        )
    return recovered


def _recover_otsu_digit_from_zero_alias_conflict(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> tuple[int, float | None] | None:
    """Prefer Otsu when the primary zero is a letter-alias shadow read.

    Compact incident cells can show a crisp white digit on a dark badge with a
    right-edge decoration. For visible ``3`` cells, primary may read only the
    shadow as ``o`` (=0), sharpened may hallucinate the curved edge as ``2``,
    while Otsu isolates the actual digit. Keep this recovery narrow so normal
    zero cells and high-confidence sharpened reads are unaffected.
    """

    recovery: tuple[int, float | None] | None = None
    if len(fallback_results) >= MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY:
        sharpened = fallback_results[0]
        otsu = fallback_results[1]
        zero_alias_primary = primary.count == 0 and not _contains_digit(primary.raw_text)
        otsu_digit = _is_single_plausible_nonzero_digit(otsu, max_plausible_count)
        sharpened_digit = _is_single_plausible_nonzero_digit(
            sharpened,
            max_plausible_count,
        )
        sharpened_confidence = sharpened.confidence or 0.0
        should_recover = (
            zero_alias_primary
            and otsu_digit
            and sharpened_digit
            and otsu.count != sharpened.count
            and sharpened_confidence < SHARPENED_CONFLICT_CONFIDENCE_THRESHOLD
        )
        if should_recover and otsu.count is not None:
            recovery = otsu.count, otsu.confidence
    return recovery


def _recover_otsu_one_from_seven_alias_conflict(
    primary: CountRecognitionResult,
    fallback_results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> tuple[int, float | None] | None:
    """Prefer Otsu for FullHD compact cells where a visible 1 looks like 7.

    Native 1920x1080 桃鉄2 captures keep the compact cell decoration crisp.
    The primary and sharpened variants can then read the left stroke/shadow of
    a visible ``1`` as ``7`` while Otsu isolates the foreground digit. Keep the
    recovery narrow: only ``7``/missing non-Otsu candidates may conflict, the
    Otsu candidate must be an exact single ``1``, and very high-confidence
    seven reads are left alone.
    """

    recovery: tuple[int, float | None] | None = None
    has_required_fallbacks = (
        max_plausible_count >= SEVEN_ALIAS_COUNT
        and len(fallback_results) >= MIN_FALLBACK_VARIANTS_FOR_OTSU_RECOVERY
    )
    if has_required_fallbacks:
        sharpened = fallback_results[0]
        otsu = fallback_results[1]
        non_otsu = (primary, sharpened)
        seven_candidates = [result for result in non_otsu if result.count == SEVEN_ALIAS_COUNT]
        has_other_digit = any(
            result.count is not None and result.count != SEVEN_ALIAS_COUNT for result in non_otsu
        )
        if _is_exact_single_digit(otsu, ONE_COUNT) and seven_candidates and not has_other_digit:
            seven_confidence = max((result.confidence or 0.0) for result in seven_candidates)
            if seven_confidence <= SEVEN_ONE_CONFLICT_CONFIDENCE_THRESHOLD:
                recovery = ONE_COUNT, otsu.confidence
    return recovery


def _contains_digit(text: str) -> bool:
    return any(char.isdigit() for char in text)


def _is_exact_single_digit(result: CountRecognitionResult, count: int) -> bool:
    if result.count != count:
        return False
    pieces = [piece.strip() for piece in result.raw_text.split("|") if piece.strip()]
    return any(piece == str(count) for piece in pieces)


def _is_single_plausible_nonzero_digit(
    result: CountRecognitionResult,
    max_plausible_count: int,
) -> bool:
    if result.count is None or not 0 < result.count <= min(9, max_plausible_count):
        return False
    pieces = [piece.strip() for piece in result.raw_text.split("|") if piece.strip()]
    return any(piece == str(result.count) for piece in pieces)


def _recover_plausible_leading_digit(
    results: list[CountRecognitionResult],
    *,
    max_plausible_count: int,
) -> tuple[int, float | None] | None:
    """Recover a one-digit value when all OCR variants over-read the same prefix.

    Compact 桃鉄2 cells have a right-edge chevron. When that decoration is
    captured with a real digit, OCR can produce overlarge values like 31/35 for
    a visible 3. This recovery only applies when no normal plausible candidate
    exists and every multi-digit candidate agrees on the same plausible leading
    digit.
    """

    leading_digits: list[int] = []
    confidences: list[float] = []
    for result in results:
        if result.count is None or result.count <= max_plausible_count:
            continue
        for piece in (piece.strip() for piece in result.raw_text.split("|")):
            digits = "".join(ch for ch in piece if ch.isdigit())
            if len(digits) <= 1:
                continue
            leading = int(digits[0])
            if 0 < leading <= max_plausible_count:
                leading_digits.append(leading)
                if result.confidence is not None:
                    confidences.append(result.confidence)
                break
    if not leading_digits or len(set(leading_digits)) != 1:
        return None
    return leading_digits[0], max(confidences) if confidences else None


def plausibility_warnings(
    player_counts: list[dict[str, OcrField[int]]],
) -> list[OcrWarning]:
    """Emit warnings for individually high counts and per-player totals."""
    warnings: list[OcrWarning] = []
    ginji_total = 0
    for player_index, counts in enumerate(player_counts):
        station_total = 0
        for incident_name, field in counts.items():
            if field.value is None:
                continue
            if incident_name == GINJI_INCIDENT_NAME:
                ginji_total += field.value
                continue
            station_total += field.value
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


def _suspicious_count_warning(*, field_path: str, message: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.SUSPICIOUS_INCIDENT_COUNT,
        message=message,
        field_path=field_path,
    )
