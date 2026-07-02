"""Incident-log screen orchestration.

This is the only module that knows about profile selection, payload
assembly and the debug-summary side effects. Cell-level OCR lives in
``cell_recognition`` and pure voting/plausibility helpers live in
``voting``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.incident_log.attempts import CountRecognitionResult, IncidentParseAttempt
from momo_ocr.features.incident_log.cell_recognition import (
    recognize_count_cell,
)
from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.incident_log.parser_debug import (
    prepare_cell_debug,
    write_cell_debug_summary,
)
from momo_ocr.features.incident_log.parser_debug import (
    profile_debug_dir as resolve_profile_debug_dir,
)
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
    IncidentRowProfile,
    select_incident_log_profiles,
)
from momo_ocr.features.incident_log.voting import plausibility_warnings
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.player_order.detector import apply_player_order_to_column_players
from momo_ocr.features.temp_images.validation import open_decoded_image

PLAYER_COUNT = 4


@dataclass(frozen=True)
class IncidentLogParser:
    screen_type: ScreenType = ScreenType.INCIDENT_LOG

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = context.image
        owns_image = image is None
        if image is None:
            image = open_decoded_image(context.image_path)
        try:
            image_size = Size(width=image.width, height=image.height)
            debug_dir = (
                context.debug_dir / "incident_log" if context.debug_dir is not None else None
            )
            if debug_dir is not None:
                debug_dir.mkdir(parents=True, exist_ok=True)

            selected_attempt = _select_best_attempt(
                context=context,
                image=image,
                image_size=image_size,
                debug_dir=debug_dir,
            )
            return _payload_from_attempt(context, selected_attempt)
        finally:
            if owns_image:
                image.close()


@dataclass(frozen=True)
class _CellRecognitionContext:
    parse_context: ScreenParseContext
    image: Image.Image
    image_size: Size
    profile_debug_dir: Path | None
    cell_debug_records: list[dict[str, Any]]


def _select_best_attempt(
    *,
    context: ScreenParseContext,
    image: Image.Image,
    image_size: Size,
    debug_dir: Path | None,
) -> IncidentParseAttempt:
    profiles = select_incident_log_profiles(context.layout_family_hint)
    attempts: list[IncidentParseAttempt] = []
    for profile in profiles:
        attempts.append(
            _parse_profile(
                context=context,
                image=image,
                image_size=image_size,
                profile=profile,
                debug_dir=debug_dir,
                isolate_debug=len(profiles) > 1,
            )
        )
        if context.fast_path_enabled and attempts[-1].missing_count == 0:
            break
    return min(attempts, key=lambda attempt: attempt.missing_count)


def _parse_profile(
    *,
    context: ScreenParseContext,
    image: Image.Image,
    image_size: Size,
    profile: IncidentLogProfile,
    debug_dir: Path | None,
    isolate_debug: bool,
) -> IncidentParseAttempt:
    profile_debug_dir = resolve_profile_debug_dir(
        debug_dir, profile=profile, isolate_debug=isolate_debug
    )
    if profile_debug_dir is not None:
        profile_debug_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[OcrWarning] = []
    raw_snippets: dict[str, str] = {}
    cell_debug_records: list[dict[str, Any]] = []
    player_counts = _empty_player_counts()
    cell_context = _CellRecognitionContext(
        parse_context=context,
        image=image,
        image_size=image_size,
        profile_debug_dir=profile_debug_dir,
        cell_debug_records=cell_debug_records,
    )

    for row_profile in profile.row_profiles:
        _parse_profile_row(
            cell_context,
            row_profile=row_profile,
            player_counts=player_counts,
            raw_snippets=raw_snippets,
            warnings=warnings,
        )

    write_cell_debug_summary(
        profile_debug_dir,
        profile=profile,
        image_size=image_size,
        cell_debug_records=cell_debug_records,
    )

    return IncidentParseAttempt(
        profile=profile,
        player_counts=player_counts,
        warnings=warnings,
        raw_snippets=raw_snippets,
    )


def _parse_profile_row(
    cell_context: _CellRecognitionContext,
    *,
    row_profile: IncidentRowProfile,
    player_counts: list[dict[str, OcrField[int]]],
    raw_snippets: dict[str, str],
    warnings: list[OcrWarning],
) -> None:
    for player_index, _cell_roi in enumerate(row_profile.cell_rois):
        field_path = f"players[{player_index}].incidents[{row_profile.incident_name!r}]"
        recognition = _recognize_profile_cell(
            cell_context,
            row_profile=row_profile,
            player_index=player_index,
        )
        raw_snippets[f"{row_profile.incident_name}_player_{player_index + 1}"] = (
            recognition.raw_text
        )
        if recognition.count is None:
            warnings.append(
                _missing_count_warning(row_profile.incident_name, player_index, field_path)
            )
        player_counts[player_index][row_profile.incident_name] = OcrField(
            value=recognition.count,
            raw_text=recognition.raw_text,
            confidence=recognition.confidence,
        )


def _payload_from_attempt(
    context: ScreenParseContext,
    selected_attempt: IncidentParseAttempt,
) -> OcrDraftPayload:
    warnings = [
        *context.warnings,
        *selected_attempt.warnings,
        *plausibility_warnings(selected_attempt.player_counts),
    ]
    players = [PlayerResultDraft(incidents=counts) for counts in selected_attempt.player_counts]
    players = apply_player_order_to_column_players(players, context.player_order_detection)
    rows = _payload_rows(selected_attempt, warnings)
    return OcrDraftPayload(
        requested_screen_type=context.requested_screen_type,
        detected_screen_type=context.detected_screen_type,
        profile_id=context.profile_id,
        players=players,
        category_payload={
            "status": "parsed",
            "parser": "incident_log",
            "layout_profile_id": selected_attempt.profile.id,
            "incident_names": MVP_INCIDENT_NAMES,
            "rows": rows,
            "player_order": context.player_order_detection,
            "include_raw_text": context.include_raw_text,
        },
        warnings=warnings,
        raw_snippets=selected_attempt.raw_snippets if context.include_raw_text else None,
    )


def _payload_rows(
    selected_attempt: IncidentParseAttempt,
    warnings: list[OcrWarning],
) -> list[IncidentLogRow]:
    return [
        IncidentLogRow(
            raw_player_name=None,
            counts={
                incident_name: selected_attempt.player_counts[player_index][incident_name].value
                for incident_name in MVP_INCIDENT_NAMES
            },
            confidence=None,
            warnings=_row_warning_codes(warnings, player_index),
        )
        for player_index in range(PLAYER_COUNT)
    ]


def _row_warning_codes(warnings: list[OcrWarning], player_index: int) -> list[str]:
    prefix = f"players[{player_index}]."
    return [
        warning.code.value
        for warning in warnings
        if warning.field_path is not None and warning.field_path.startswith(prefix)
    ]


def _recognize_profile_cell(
    cell_context: _CellRecognitionContext,
    *,
    row_profile: IncidentRowProfile,
    player_index: int,
) -> CountRecognitionResult:
    cell_image = crop_roi(
        cell_context.image,
        scale_profile_rect_to_image(row_profile.cell_rois[player_index], cell_context.image_size),
    )
    cell_debug = prepare_cell_debug(
        cell_image,
        row_profile=row_profile,
        player_index=player_index,
        profile_debug_dir=cell_context.profile_debug_dir,
        cell_debug_records=cell_context.cell_debug_records,
    )
    recognition = recognize_count_cell(
        cell_context.parse_context,
        cell_image,
        incident_name=row_profile.incident_name,
        debug_dir=cell_context.profile_debug_dir,
        debug_suffix=f"{row_profile.incident_name}_player_{player_index + 1}",
        debug_sink=cell_debug,
    )
    if cell_debug is not None:
        cell_debug["final_count"] = recognition.count
        cell_debug["final_confidence"] = recognition.confidence
        cell_debug["final_raw_text"] = recognition.raw_text
    return recognition


def _empty_player_counts() -> list[dict[str, OcrField[int]]]:
    return [
        {incident_name: OcrField[int](value=None) for incident_name in MVP_INCIDENT_NAMES}
        for _ in range(PLAYER_COUNT)
    ]


def _missing_count_warning(incident_name: str, player_index: int, field_path: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.MISSING_INCIDENT_COUNT,
        message=f"Could not read {incident_name} count for player column {player_index + 1}.",
        field_path=field_path,
    )
