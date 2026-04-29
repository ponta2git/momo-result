from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RecognizedText:
    text: str
    confidence: float | None
