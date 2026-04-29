from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ImageMetadata:
    path: Path
    format: str
    width: int
    height: int
    size_bytes: int
