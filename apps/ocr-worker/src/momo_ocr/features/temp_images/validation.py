from __future__ import annotations

from pathlib import Path

from PIL import Image, UnidentifiedImageError

from momo_ocr.features.image_processing.geometry import Size
from momo_ocr.features.image_processing.preprocessing import ensure_supported_dimensions
from momo_ocr.features.temp_images.models import ImageMetadata
from momo_ocr.shared.errors import FailureCode, OcrError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_IMAGE_BYTES = 500 * 1024


def read_image_metadata(path: Path, *, enforce_size_limit: bool = True) -> ImageMetadata:
    if not path.exists():
        raise OcrError(FailureCode.TEMP_IMAGE_MISSING, "Temporary image file does not exist.")
    if not path.is_file():
        raise OcrError(FailureCode.INVALID_IMAGE, "Image path is not a file.")

    size_bytes = path.stat().st_size
    if enforce_size_limit and size_bytes > MAX_IMAGE_BYTES:
        raise OcrError(FailureCode.IMAGE_TOO_LARGE, "Image exceeds the 500KB upload limit.")

    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image_format = image.format or "UNKNOWN"
            width, height = image.size
    except UnidentifiedImageError as exc:
        raise OcrError(FailureCode.DECODE_FAILED, "Image could not be decoded.") from exc

    if image_format not in ALLOWED_FORMATS:
        raise OcrError(
            FailureCode.UNSUPPORTED_IMAGE_FORMAT, f"Unsupported image format: {image_format}"
        )
    ensure_supported_dimensions(Size(width=width, height=height))

    return ImageMetadata(
        path=path, format=image_format, width=width, height=height, size_bytes=size_bytes
    )


def open_decoded_image(path: Path) -> Image.Image:
    try:
        with Image.open(path) as image:
            return image.convert("RGB")
    except UnidentifiedImageError as exc:
        raise OcrError(FailureCode.DECODE_FAILED, "Image could not be decoded.") from exc
