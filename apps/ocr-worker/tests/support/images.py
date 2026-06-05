from __future__ import annotations

from pathlib import Path

from PIL import Image

type ImageColor = str | int | tuple[int, int, int] | tuple[int, int, int, int]


def make_test_image(
    *,
    size: tuple[int, int] = (1280, 720),
    mode: str = "RGB",
    color: ImageColor = "white",
) -> Image.Image:
    return Image.new(mode, size, color=color)


def write_test_image(
    path: Path,
    *,
    size: tuple[int, int] = (1280, 720),
    mode: str = "RGB",
    color: ImageColor = "white",
    image_format: str = "JPEG",
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    make_test_image(size=size, mode=mode, color=color).save(path, format=image_format)
    return path
