from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from PIL import Image


class DebugSink(Protocol):
    @property
    def enabled(self) -> bool:
        raise NotImplementedError

    def child(self, name: str) -> DebugSink:
        raise NotImplementedError

    def save_image(self, filename: str, image: Image.Image) -> None:
        raise NotImplementedError

    def write_json(self, filename: str, value: object) -> None:
        raise NotImplementedError


@dataclass(frozen=True)
class NullDebugSink:
    @property
    def enabled(self) -> bool:
        return False

    def child(self, name: str) -> DebugSink:
        del name
        return self

    def save_image(self, filename: str, image: Image.Image) -> None:
        del filename, image

    def write_json(self, filename: str, value: object) -> None:
        del filename, value


@dataclass(frozen=True)
class FilesystemDebugSink:
    root: Path

    @property
    def enabled(self) -> bool:
        return True

    def child(self, name: str) -> DebugSink:
        return FilesystemDebugSink(self.root / name)

    def save_image(self, filename: str, image: Image.Image) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        image.save(self.root / filename)

    def write_json(self, filename: str, value: object) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / filename).write_text(
            json.dumps(value, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


NULL_DEBUG_SINK = NullDebugSink()


def debug_sink_from_dir(debug_dir: Path | None) -> DebugSink:
    if debug_dir is None:
        return NULL_DEBUG_SINK
    debug_dir.mkdir(parents=True, exist_ok=True)
    return FilesystemDebugSink(debug_dir)
