from __future__ import annotations

from typing import Any

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size
from momo_ocr.features.incident_log.cell_recognition import prepare_count_cell_image
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
    IncidentRowProfile,
)
from momo_ocr.features.parser_core.debug import DebugSink


def prepare_cell_debug(
    cell_image: Image.Image,
    *,
    row_profile: IncidentRowProfile,
    player_index: int,
    profile_debug_sink: DebugSink,
    cell_debug_records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not profile_debug_sink.enabled:
        return None
    suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
    prepared_cell = prepare_count_cell_image(cell_image)
    profile_debug_sink.save_image(f"{suffix}_cell.png", cell_image)
    profile_debug_sink.save_image(f"{suffix}_cell_prepared.png", prepared_cell)
    cell_debug: dict[str, Any] = {
        "incident_name": row_profile.incident_name,
        "player_index": player_index,
        "cell_image": f"{suffix}_cell.png",
        "prepared_image": f"{suffix}_cell_prepared.png",
        "variants": [],
    }
    cell_debug_records.append(cell_debug)
    return cell_debug


def write_cell_debug_summary(
    profile_debug_sink: DebugSink,
    *,
    profile: IncidentLogProfile,
    image_size: Size,
    cell_debug_records: list[dict[str, Any]],
) -> None:
    if not profile_debug_sink.enabled or not cell_debug_records:
        return
    summary = {
        "profile_id": profile.id,
        "image_size": {"width": image_size.width, "height": image_size.height},
        "incident_names": list(MVP_INCIDENT_NAMES),
        "cells": cell_debug_records,
    }
    profile_debug_sink.write_json("cells.json", summary)


def profile_debug_sink(
    debug_sink: DebugSink,
    *,
    profile: IncidentLogProfile,
    isolate_debug: bool,
) -> DebugSink:
    if isolate_debug:
        return debug_sink.child(profile.id)
    return debug_sink
