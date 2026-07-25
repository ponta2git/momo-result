from __future__ import annotations

from PIL import Image, ImageChops

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
_BYTE_MAX = 255
_DEGREES_MAX = 360
_SATURATION_THRESHOLD = round(MIN_SATURATION * _BYTE_MAX)
_VALUE_THRESHOLD = round(MIN_VALUE * _BYTE_MAX)
_SATURATION_MASK_LUT = tuple(
    _BYTE_MAX if value >= _SATURATION_THRESHOLD else 0 for value in range(_BYTE_MAX + 1)
)
_VALUE_MASK_LUT = tuple(
    _BYTE_MAX if value >= _VALUE_THRESHOLD else 0 for value in range(_BYTE_MAX + 1)
)


def detect_dominant_player_color(image: Image.Image) -> tuple[PlayerColor | None, float]:
    hue, saturation, value = image.convert("HSV").split()
    saturated_mask = ImageChops.multiply(
        saturation.point(_SATURATION_MASK_LUT, mode="L"),
        value.point(_VALUE_MASK_LUT, mode="L"),
    )
    saturated_count = _white_pixel_count(saturated_mask)

    if saturated_count == 0:
        return None, 0.0

    counts = {
        color: _white_pixel_count(
            ImageChops.multiply(saturated_mask, hue.point(mask_lut, mode="L"))
        )
        for color, mask_lut in _HUE_MASK_LUTS.items()
    }
    detected_color, count = max(counts.items(), key=lambda item: item[1])
    return detected_color, count / saturated_count


def _hue_byte_in_ranges(value: int, ranges: tuple[tuple[int, int], ...]) -> bool:
    degrees = _hue_byte_to_degrees(value)
    return any(start <= degrees <= end for start, end in ranges)


def _hue_byte_to_degrees(value: int) -> float:
    return value * _DEGREES_MAX / _BYTE_MAX


def _white_pixel_count(mask: Image.Image) -> int:
    return mask.histogram()[_BYTE_MAX]


_HUE_MASK_LUTS = {
    color: tuple(
        _BYTE_MAX if _hue_byte_in_ranges(value, ranges) else 0 for value in range(_BYTE_MAX + 1)
    )
    for color, ranges in COLOR_HUE_RANGES
}
