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
BUTTON_XS = (114, 548, 981, 1414)
BUTTON_Y = 970
BUTTON_WIDTH = 410
BUTTON_HEIGHT = 90


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
        indicator_roi=Rect(
            x=BUTTON_XS[index],
            y=BUTTON_Y,
            width=BUTTON_WIDTH,
            height=BUTTON_HEIGHT,
        ),
        name_roi=Rect(
            x=BUTTON_XS[index],
            y=BUTTON_Y,
            width=BUTTON_WIDTH,
            height=BUTTON_HEIGHT,
        ),
    )
    for index, color in enumerate(EXPECTED_COLOR_ORDER)
)
