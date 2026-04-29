from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_results.models import ImageType, OcrWarning

__all__ = ["DetectionResult", "ImageType"]


@dataclass(frozen=True)
class DetectionResult:
    requested_type: ImageType
    detected_type: ImageType | None
    profile_id: str | None
    confidence: float
    warnings: list[OcrWarning]
    evidence_text: str | None = None
