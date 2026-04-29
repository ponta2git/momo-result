from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from momo_ocr.features.ocr_domain.models import OcrWarning


class PlayerColor(StrEnum):
    BLUE = "blue"
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


@dataclass(frozen=True)
class PlayerOrderSlot:
    play_order: int
    expected_color: PlayerColor
    detected_color: PlayerColor | None
    raw_player_name: str | None
    color_confidence: float
    name_confidence: float | None


@dataclass(frozen=True)
class PlayerOrderDetection:
    slots: list[PlayerOrderSlot]
    confidence: float
    warnings: list[OcrWarning] = field(default_factory=list)
