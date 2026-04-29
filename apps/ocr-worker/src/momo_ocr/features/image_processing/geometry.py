from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Size:
    width: int
    height: int

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    width: int
    height: int


FULL_HD = Size(width=1920, height=1080)


def scale_rect_between(rect: Rect, *, from_size: Size, to_size: Size) -> Rect:
    x_scale = to_size.width / from_size.width
    y_scale = to_size.height / from_size.height
    return Rect(
        x=round(rect.x * x_scale),
        y=round(rect.y * y_scale),
        width=round(rect.width * x_scale),
        height=round(rect.height * y_scale),
    )


def scale_profile_rect_to_image(rect: Rect, image_size: Size) -> Rect:
    return scale_rect_between(rect, from_size=FULL_HD, to_size=image_size)


def scale_image_rect_to_profile(rect: Rect, image_size: Size) -> Rect:
    return scale_rect_between(rect, from_size=image_size, to_size=FULL_HD)


def has_supported_aspect_ratio(
    size: Size, *, expected: Size = FULL_HD, tolerance: float = 0.01
) -> bool:
    return abs(size.aspect_ratio - expected.aspect_ratio) <= tolerance
