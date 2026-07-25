from __future__ import annotations

from PIL import Image

from momo_ocr.features.image_processing.geometry import Rect


def crop_roi(image: Image.Image, rect: Rect) -> Image.Image:
    return image.crop((rect.x, rect.y, rect.x + rect.width, rect.y + rect.height))
