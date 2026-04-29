from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.image_processing.geometry import Rect
from momo_ocr.features.player_order.models import PlayerColor

EXPECTED_COLOR_ORDER = (
    PlayerColor.BLUE,
    PlayerColor.RED,
    PlayerColor.YELLOW,
    PlayerColor.GREEN,
)


@dataclass(frozen=True)
class PlayerOrderSlotProfile:
    play_order: int
    expected_color: PlayerColor
    indicator_roi: Rect
    name_roi: Rect


SLOT_PROFILES = tuple(
    PlayerOrderSlotProfile(
        play_order=index + 1,
        expected_color=color,
        indicator_roi=Rect(x=index * 480, y=930, width=480, height=150),
        name_roi=Rect(x=index * 480, y=930, width=480, height=150),
    )
    for index, color in enumerate(EXPECTED_COLOR_ORDER)
)
