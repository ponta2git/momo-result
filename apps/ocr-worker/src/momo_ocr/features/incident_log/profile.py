from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from momo_ocr.features.image_processing.geometry import Rect

PROFILE_ID = "full-hd-incident-log-v1"
MVP_INCIDENT_NAMES = ("目的地", "プラス駅", "マイナス駅", "カード駅", "カード売り場", "スリの銀次")


@dataclass(frozen=True)
class IncidentRowProfile:
    incident_name: str
    cell_rois: tuple[Rect, Rect, Rect, Rect]


_CELL_XS = (878, 1148, 1418, 1680)
_CELL_WIDTH = 98
_CELL_HEIGHT = 75

ROW_PROFILES = tuple(
    IncidentRowProfile(
        incident_name=incident_name,
        cell_rois=cast(
            "tuple[Rect, Rect, Rect, Rect]",
            tuple(Rect(x=x, y=y, width=_CELL_WIDTH, height=_CELL_HEIGHT) for x in _CELL_XS),
        ),
    )
    for incident_name, y in zip(
        MVP_INCIDENT_NAMES,
        (330, 420, 510, 600, 690, 780),
        strict=True,
    )
)
