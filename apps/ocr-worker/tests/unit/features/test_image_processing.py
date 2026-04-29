from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.image_processing.geometry import (
    FULL_HD,
    Rect,
    Size,
    has_supported_aspect_ratio,
    scale_image_rect_to_profile,
    scale_profile_rect_to_image,
)
from momo_ocr.features.image_processing.preprocessing import normalize_to_full_hd
from momo_ocr.features.image_processing.roi import crop_roi, save_debug_roi


def test_scale_profile_rect_to_720p_image() -> None:
    rect = Rect(x=960, y=540, width=192, height=108)

    scaled = scale_profile_rect_to_image(rect, Size(width=1280, height=720))

    assert scaled == Rect(x=640, y=360, width=128, height=72)
    assert scale_image_rect_to_profile(scaled, Size(width=1280, height=720)) == rect


def test_aspect_ratio_accepts_16_by_9_sizes() -> None:
    assert has_supported_aspect_ratio(FULL_HD)
    assert has_supported_aspect_ratio(Size(width=1280, height=720))
    assert not has_supported_aspect_ratio(Size(width=1024, height=768))


def test_normalize_to_full_hd_resizes_720p_image() -> None:
    image = Image.new("RGB", (1280, 720), color="white")

    normalized = normalize_to_full_hd(image)

    assert normalized.size == (1920, 1080)


def test_crop_and_save_debug_roi(tmp_path: Path) -> None:
    image = Image.new("RGB", (100, 50), color="white")
    rect = Rect(x=10, y=5, width=20, height=10)

    cropped = crop_roi(image, rect)
    output_path = tmp_path / "debug" / "roi.png"
    save_debug_roi(image, rect, output_path)

    assert cropped.size == (20, 10)
    assert output_path.exists()
