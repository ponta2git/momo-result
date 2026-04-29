from __future__ import annotations

from pathlib import Path


def resolve_local_image(path: Path) -> Path:
    return path.expanduser().resolve()
