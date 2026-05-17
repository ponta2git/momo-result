from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from momo_ocr.features.temp_images.cleanup import delete_if_exists
from momo_ocr.features.temp_images.storage import resolve_local_image
from momo_ocr.features.temp_images.validation import open_decoded_image, read_image_metadata
from momo_ocr.shared.errors import FailureCode, OcrError


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


def test_read_image_metadata_reports_missing_temp_image(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing.jpg"

    with pytest.raises(OcrError) as exc_info:
        read_image_metadata(missing_path)

    assert exc_info.value.code is FailureCode.TEMP_IMAGE_MISSING
    assert exc_info.value.user_action == "Re-upload the screenshot and run OCR again."


def test_read_image_metadata_rejects_images_above_4k_dimensions(tmp_path: Path) -> None:
    image_path = tmp_path / "too-large.png"
    Image.new("RGB", (3841, 2161), color="white").save(image_path, format="PNG")

    with pytest.raises(OcrError) as exc_info:
        read_image_metadata(image_path, enforce_size_limit=False)

    assert exc_info.value.code is FailureCode.IMAGE_TOO_LARGE


def test_open_decoded_image_rejects_images_above_4k_before_conversion(tmp_path: Path) -> None:
    image_path = tmp_path / "too-large.png"
    Image.new("RGB", (3841, 2161), color="white").save(image_path, format="PNG")

    with pytest.raises(OcrError) as exc_info:
        open_decoded_image(image_path)

    assert exc_info.value.code is FailureCode.IMAGE_TOO_LARGE


def test_open_decoded_image_reports_missing_temp_image(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing.jpg"

    with pytest.raises(OcrError) as exc_info:
        open_decoded_image(missing_path)

    assert exc_info.value.code is FailureCode.TEMP_IMAGE_MISSING
    assert exc_info.value.user_action == "Re-upload the screenshot and run OCR again."


def test_resolve_local_image_rejects_path_outside_configured_root(tmp_path: Path) -> None:
    root = tmp_path / "uploads"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    image_path = outside / "sample.jpg"
    image_path.write_bytes(b"not used")

    with pytest.raises(OcrError) as exc_info:
        resolve_local_image(image_path, root=root)

    assert exc_info.value.code is FailureCode.QUEUE_FAILURE
    assert str(image_path) not in exc_info.value.message


def test_resolve_local_image_rejects_symlink_escaping_configured_root(tmp_path: Path) -> None:
    root = tmp_path / "uploads"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    target = outside / "sample.jpg"
    target.write_bytes(b"not used")
    link = root / "linked.jpg"
    link.symlink_to(target)

    with pytest.raises(OcrError) as exc_info:
        resolve_local_image(link, root=root)

    assert exc_info.value.code is FailureCode.QUEUE_FAILURE


def test_delete_if_exists_removes_file(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(b"temporary")

    assert delete_if_exists(image_path)
    assert not image_path.exists()
    assert not delete_if_exists(image_path)
