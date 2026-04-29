from __future__ import annotations

from PIL import Image, ImageOps

from momo_ocr.features.image_processing.geometry import FULL_HD, Size
from momo_ocr.shared.errors import FailureCode, OcrError

MIN_RELIABLE_WIDTH = 640
MIN_RELIABLE_HEIGHT = 360


def to_grayscale(image: Image.Image) -> Image.Image:
    return ImageOps.grayscale(image)


def normalize_to_full_hd(image: Image.Image) -> Image.Image:
    if image.size == (FULL_HD.width, FULL_HD.height):
        return image.copy()
    return image.resize((FULL_HD.width, FULL_HD.height), Image.Resampling.LANCZOS)


def ensure_supported_dimensions(size: Size) -> None:
    if size.width <= 0 or size.height <= 0:
        raise OcrError(FailureCode.INVALID_IMAGE, "Image dimensions must be positive.")
    if size.width < MIN_RELIABLE_WIDTH or size.height < MIN_RELIABLE_HEIGHT:
        raise OcrError(FailureCode.LAYOUT_UNSUPPORTED, "Image is too small for reliable OCR.")
