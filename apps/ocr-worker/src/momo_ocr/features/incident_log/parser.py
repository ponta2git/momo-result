"""Incident-log screen orchestration.

This is the only module that knows about profile selection, payload
assembly and the debug-summary side effects. Cell-level OCR lives in
``cell_recognition`` and pure voting/plausibility helpers live in
``voting``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.incident_log.attempts import IncidentParseAttempt
from momo_ocr.features.incident_log.cell_recognition import (
    prepare_count_cell_image,
    recognize_count_cell,
)
from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
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
from momo_ocr.features.text_recognition.fast_path import is_fast_path_enabled

PLAYER_COUNT = 4


@dataclass(frozen=True)
class IncidentLogParser:
    screen_type: ScreenType = ScreenType.INCIDENT_LOG

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = (
            context.image if context.image is not None else open_decoded_image(context.image_path)
        )
        image_size = Size(width=image.width, height=image.height)
        debug_dir = context.debug_dir / "incident_log" if context.debug_dir is not None else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        profiles = select_incident_log_profiles(context.layout_family_hint)
        # Fast-path: incident_log profiles are tried in priority order; once a
        # profile recognises every cell (missing_count == 0) the remaining
        # profiles cannot improve on it, so skip them. Default behaviour
        # evaluates all profiles for highest recall.
        fast_path = is_fast_path_enabled()
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
            if fast_path and attempts[-1].missing_count == 0:
                break
        selected_attempt = min(attempts, key=lambda attempt: attempt.missing_count)

        warnings = [
            *context.warnings,
            *selected_attempt.warnings,
            *plausibility_warnings(selected_attempt.player_counts),
        ]
        players = [PlayerResultDraft(incidents=counts) for counts in selected_attempt.player_counts]
        players = apply_player_order_to_column_players(players, context.player_order_detection)
        rows = [
            IncidentLogRow(
                raw_player_name=None,
                counts={
                    incident_name: selected_attempt.player_counts[player_index][incident_name].value
                    for incident_name in MVP_INCIDENT_NAMES
                },
                confidence=None,
                warnings=[
                    warning.code.value
                    for warning in warnings
                    if warning.field_path is not None
                    and warning.field_path.startswith(f"players[{player_index}].")
                ],
            )
            for player_index in range(PLAYER_COUNT)
        ]
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


def _parse_profile(
    *,
    context: ScreenParseContext,
    image: Image.Image,
    image_size: Size,
    profile: IncidentLogProfile,
    debug_dir: Path | None,
    isolate_debug: bool,
) -> IncidentParseAttempt:
    profile_debug_dir = (
        debug_dir / profile.id if debug_dir is not None and isolate_debug else debug_dir
    )
    if profile_debug_dir is not None:
        profile_debug_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[OcrWarning] = []
    raw_snippets: dict[str, str] = {}
    cell_debug_records: list[dict[str, Any]] = []
    player_counts = [
        {incident_name: OcrField[int](value=None) for incident_name in MVP_INCIDENT_NAMES}
        for _ in range(PLAYER_COUNT)
    ]

    for row_profile in profile.row_profiles:
        for player_index, cell_roi in enumerate(row_profile.cell_rois):
            cell_image = crop_roi(image, scale_profile_rect_to_image(cell_roi, image_size))
            prepared_cell = prepare_count_cell_image(cell_image)
            cell_debug: dict[str, Any] | None = None
            if profile_debug_dir is not None:
                suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
                cell_image.save(profile_debug_dir / f"{suffix}_cell.png")
                prepared_cell.save(profile_debug_dir / f"{suffix}_cell_prepared.png")
                # DEBUG: 各セルの PSM 試行を後から検証できるよう構造化ログを溜める。
                # MOMO_OCR_DEBUG_DIR が無効なら profile_debug_dir 自体が None なので
                # 通常運用では完全に no-op。
                cell_debug = {
                    "incident_name": row_profile.incident_name,
                    "player_index": player_index,
                    "cell_image": f"{suffix}_cell.png",
                    "prepared_image": f"{suffix}_cell_prepared.png",
                    "variants": [],
                }
                cell_debug_records.append(cell_debug)

            recognition = recognize_count_cell(
                context,
                cell_image,
                incident_name=row_profile.incident_name,
                debug_dir=profile_debug_dir,
                debug_suffix=f"{row_profile.incident_name}_player_{player_index + 1}",
                debug_sink=cell_debug,
            )
            if cell_debug is not None:
                cell_debug["final_count"] = recognition.count
                cell_debug["final_confidence"] = recognition.confidence
                cell_debug["final_raw_text"] = recognition.raw_text
            field_path = f"players[{player_index}].incidents[{row_profile.incident_name!r}]"
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

    if profile_debug_dir is not None and cell_debug_records:
        # DEBUG: ROI/前処理/PSM ごとの判断を一覧で確認できる JSON を吐く。
        summary = {
            "profile_id": profile.id,
            "image_size": {"width": image_size.width, "height": image_size.height},
            "incident_names": list(MVP_INCIDENT_NAMES),
            "cells": cell_debug_records,
        }
        (profile_debug_dir / "cells.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return IncidentParseAttempt(
        profile=profile,
        player_counts=player_counts,
        warnings=warnings,
        raw_snippets=raw_snippets,
    )


def _missing_count_warning(incident_name: str, player_index: int, field_path: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.MISSING_INCIDENT_COUNT,
        message=f"Could not read {incident_name} count for player column {player_index + 1}.",
        field_path=field_path,
    )
