from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.temp_images.cleanup import delete_if_exists
from momo_ocr.features.temp_images.validation import open_decoded_image, read_image_metadata


def test_read_image_metadata_allows_local_sample_without_size_limit(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    Image.new("RGB", (1920, 1080), color="white").save(image_path, format="JPEG")

    metadata = read_image_metadata(image_path, enforce_size_limit=False)

    assert metadata.format == "JPEG"
    assert metadata.width == 1920
    assert metadata.height == 1080
    assert metadata.size_bytes > 0


def test_open_decoded_image_returns_rgb(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    Image.new("L", (640, 360), color=255).save(image_path, format="JPEG")

    image = open_decoded_image(image_path)

    assert image.mode == "RGB"
    assert image.size == (640, 360)


def test_delete_if_exists_removes_file(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(b"temporary")

    assert delete_if_exists(image_path)
    assert not image_path.exists()
    assert not delete_if_exists(image_path)
