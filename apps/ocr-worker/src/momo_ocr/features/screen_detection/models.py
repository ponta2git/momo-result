from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_domain.models import OcrWarning, ScreenType

__all__ = ["ScreenDetectionResult"]


@dataclass(frozen=True)
class ScreenDetectionResult:
    requested_type: ScreenType
    detected_type: ScreenType | None
    profile_id: str | None
    confidence: float
    warnings: list[OcrWarning]
    evidence_text: str | None = None
