from __future__ import annotations

import colorsys
from collections.abc import Iterable
from typing import cast

from PIL import Image

from momo_ocr.features.player_order.models import PlayerColor

MIN_COLOR_CONFIDENCE = 0.45
MIN_SATURATION = 0.45
MIN_VALUE = 0.25
RED_HUE_MAX = 20
RED_HUE_MIN = 330
YELLOW_HUE_MIN = 30
YELLOW_HUE_MAX = 65
GREEN_HUE_MIN = 75
GREEN_HUE_MAX = 130
BLUE_HUE_MIN = 185
BLUE_HUE_MAX = 240
COLOR_HUE_RANGES = (
    (PlayerColor.RED, ((0, RED_HUE_MAX), (RED_HUE_MIN, 360))),
    (PlayerColor.YELLOW, ((YELLOW_HUE_MIN, YELLOW_HUE_MAX),)),
    (PlayerColor.GREEN, ((GREEN_HUE_MIN, GREEN_HUE_MAX),)),
    (PlayerColor.BLUE, ((BLUE_HUE_MIN, BLUE_HUE_MAX),)),
)


def detect_dominant_player_color(image: Image.Image) -> tuple[PlayerColor | None, float]:
    counts = dict.fromkeys(PlayerColor, 0)
    saturated_count = 0
    rgb_image = image.convert("RGB")
    pixels = cast("Iterable[tuple[int, int, int]]", rgb_image.get_flattened_data())
    for red, green, blue in pixels:
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        if saturation < MIN_SATURATION or value < MIN_VALUE:
            continue
        saturated_count += 1
        color = classify_hue(hue * 360)
        if color is not None:
            counts[color] += 1

    if saturated_count == 0:
        return None, 0.0
    detected_color, count = max(counts.items(), key=lambda item: item[1])
    return detected_color, count / saturated_count


def classify_hue(hue: float) -> PlayerColor | None:
    for color, ranges in COLOR_HUE_RANGES:
        if any(start <= hue <= end for start, end in ranges):
            return color
    return None
