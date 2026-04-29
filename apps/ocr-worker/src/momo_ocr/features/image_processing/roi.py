from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.image_processing.geometry import Rect


def crop_roi(image: Image.Image, rect: Rect) -> Image.Image:
    return image.crop((rect.x, rect.y, rect.x + rect.width, rect.y + rect.height))


def save_debug_roi(image: Image.Image, rect: Rect, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    crop_roi(image, rect).save(output_path)
