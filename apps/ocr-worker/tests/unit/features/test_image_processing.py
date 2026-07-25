from __future__ import annotations

from momo_ocr.features.image_processing.geometry import (
    Rect,
    Size,
    scale_profile_rect_to_image,
)
from momo_ocr.features.image_processing.roi import crop_roi
from tests.support.images import make_test_image


def test_scale_profile_rect_to_720p_image() -> None:
    rect = Rect(x=960, y=540, width=192, height=108)

    scaled = scale_profile_rect_to_image(rect, Size(width=1280, height=720))

    assert scaled == Rect(x=640, y=360, width=128, height=72)


def test_crop_roi() -> None:
    image = make_test_image(size=(100, 50))
    rect = Rect(x=10, y=5, width=20, height=10)

    cropped = crop_roi(image, rect)

    assert cropped.size == (20, 10)
