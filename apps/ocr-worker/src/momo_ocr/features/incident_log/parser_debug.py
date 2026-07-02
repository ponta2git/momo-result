from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size
from momo_ocr.features.incident_log.cell_recognition import prepare_count_cell_image
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
    IncidentRowProfile,
)


def prepare_cell_debug(
    cell_image: Image.Image,
    *,
    row_profile: IncidentRowProfile,
    player_index: int,
    profile_debug_dir: Path | None,
    cell_debug_records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if profile_debug_dir is None:
        return None
    suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
    prepared_cell = prepare_count_cell_image(cell_image)
    cell_image.save(profile_debug_dir / f"{suffix}_cell.png")
    prepared_cell.save(profile_debug_dir / f"{suffix}_cell_prepared.png")
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
    profile_debug_dir: Path | None,
    *,
    profile: IncidentLogProfile,
    image_size: Size,
    cell_debug_records: list[dict[str, Any]],
) -> None:
    if profile_debug_dir is None or not cell_debug_records:
        return
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


def profile_debug_dir(
    debug_dir: Path | None,
    *,
    profile: IncidentLogProfile,
    isolate_debug: bool,
) -> Path | None:
    return debug_dir / profile.id if debug_dir is not None and isolate_debug else debug_dir
