from __future__ import annotations

from pathlib import Path


def delete_if_exists(path: Path) -> bool:
    if not path.exists():
        return False
    path.unlink()
    return True
