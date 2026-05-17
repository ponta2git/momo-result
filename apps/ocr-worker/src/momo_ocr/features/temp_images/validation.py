from __future__ import annotations

import stat
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from momo_ocr.features.image_processing.geometry import Size
from momo_ocr.features.image_processing.preprocessing import ensure_supported_dimensions
from momo_ocr.features.temp_images.models import ImageMetadata
from momo_ocr.shared.errors import FailureCode, OcrError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_IMAGE_BYTES = 3 * 1024 * 1024
_MISSING_TEMP_IMAGE_ACTION = "Re-upload the screenshot and run OCR again."


def read_image_metadata(path: Path, *, enforce_size_limit: bool = True) -> ImageMetadata:
    try:
        stat_result = path.stat()
    except FileNotFoundError as exc:
        raise OcrError(
            FailureCode.TEMP_IMAGE_MISSING,
            "Temporary image file does not exist.",
            user_action=_MISSING_TEMP_IMAGE_ACTION,
        ) from exc
    except OSError as exc:
        raise OcrError(FailureCode.INVALID_IMAGE, "Image file metadata could not be read.") from exc

    if not stat.S_ISREG(stat_result.st_mode):
        raise OcrError(FailureCode.INVALID_IMAGE, "Image path is not a file.")

    size_bytes = stat_result.st_size
    if enforce_size_limit and size_bytes > MAX_IMAGE_BYTES:
        raise OcrError(FailureCode.IMAGE_TOO_LARGE, "Image exceeds the 3MB upload limit.")

    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image_format = image.format or "UNKNOWN"
            width, height = image.size
    except FileNotFoundError as exc:
        raise OcrError(
            FailureCode.TEMP_IMAGE_MISSING,
            "Temporary image file disappeared before it could be decoded.",
            user_action=_MISSING_TEMP_IMAGE_ACTION,
        ) from exc
    except UnidentifiedImageError as exc:
        raise OcrError(FailureCode.DECODE_FAILED, "Image could not be decoded.") from exc
    except OSError as exc:
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
            width, height = image.size
            ensure_supported_dimensions(Size(width=width, height=height))
            return image.convert("RGB")
    except FileNotFoundError as exc:
        raise OcrError(
            FailureCode.TEMP_IMAGE_MISSING,
            "Temporary image file disappeared before OCR could start.",
            user_action=_MISSING_TEMP_IMAGE_ACTION,
        ) from exc
    except UnidentifiedImageError as exc:
        raise OcrError(FailureCode.DECODE_FAILED, "Image could not be decoded.") from exc
    except OSError as exc:
        raise OcrError(FailureCode.DECODE_FAILED, "Image could not be decoded.") from exc
