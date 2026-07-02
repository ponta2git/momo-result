from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

from PIL import Image

from momo_ocr.shared.errors import FailureCode, OcrError

TESSDATA_CANDIDATES: tuple[str, ...] = (
    "/opt/homebrew/share/tessdata",
    "/usr/local/share/tessdata",
    "/usr/share/tesseract-ocr/5/tessdata",
    "/usr/share/tesseract-ocr/4.00/tessdata",
    "/usr/share/tessdata",
)


class TesserocrApi(Protocol):
    """Small typed surface of ``tesserocr.PyTessBaseAPI`` used by this worker."""

    def SetPageSegMode(self, psm: int) -> None:  # noqa: N802 - external API name
        raise NotImplementedError

    def SetVariable(self, key: str, value: str) -> None:  # noqa: N802
        raise NotImplementedError

    def SetImage(self, image: Image.Image) -> None:  # noqa: N802
        raise NotImplementedError

    def Recognize(self, timeout: int = 0) -> bool:  # noqa: N802
        raise NotImplementedError

    def GetUTF8Text(self) -> str:  # noqa: N802
        raise NotImplementedError

    def MeanTextConf(self) -> int | float:  # noqa: N802
        raise NotImplementedError

    def Clear(self) -> None:  # noqa: N802
        raise NotImplementedError

    def End(self) -> None:  # noqa: N802
        raise NotImplementedError


class ApiFactory(Protocol):
    """Factory signature for dependency-injected ``PyTessBaseAPI`` instances."""

    def __call__(self, *, language: str, oem: int, tessdata_path: str | None) -> TesserocrApi:
        raise NotImplementedError


@dataclass(slots=True)
class ApiCacheEntry:
    """One cached PyTessBaseAPI guarded by its own lock and var tracker."""

    api: TesserocrApi
    lock: threading.Lock
    set_variable_keys: set[str]


def resolve_tessdata_path() -> str | None:
    """Return a tessdata directory path or None to let tesseract auto-detect."""
    explicit = os.environ.get("TESSDATA_PREFIX")
    if explicit:
        return explicit
    for candidate in TESSDATA_CANDIDATES:
        if Path(candidate).is_dir():
            return candidate
    return None


def default_api_factory() -> ApiFactory:
    """Return a factory that builds real ``PyTessBaseAPI`` instances."""
    try:
        import tesserocr  # noqa: PLC0415
    except ImportError as exc:
        msg = (
            "tesserocr is not installed. "
            "Install OCR worker dependencies with `uv sync` to use TesserocrEngine."
        )
        raise OcrError(
            FailureCode.OCR_ENGINE_UNAVAILABLE,
            msg,
            retryable=False,
            user_action="Install OCR worker dependencies with `uv sync`.",
        ) from exc

    def factory(*, language: str, oem: int, tessdata_path: str | None) -> TesserocrApi:
        kwargs: dict[str, object] = {"lang": language, "oem": oem}
        if tessdata_path is not None:
            kwargs["path"] = tessdata_path
        return cast("TesserocrApi", tesserocr.PyTessBaseAPI(**kwargs))

    return factory
