from __future__ import annotations

from dataclasses import dataclass, field

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning
from momo_ocr.features.screen_detection.models import ScreenDetectionResult
from momo_ocr.features.temp_images.models import ImageMetadata
from momo_ocr.shared.json import dumps_json


@dataclass(frozen=True)
class AnalysisResult:
    input: ImageMetadata | None
    detection: ScreenDetectionResult | None
    result: OcrDraftPayload | None
    warnings: list[OcrWarning]
    failure_code: str | None
    failure_message: str | None
    failure_retryable: bool
    failure_user_action: str | None
    timings_ms: dict[str, float]

    def to_json(self) -> str:
        return dumps_json(self)


@dataclass(frozen=True)
class BatchReport:
    results: list[AnalysisResult] = field(default_factory=list)

    def to_json(self) -> str:
        return dumps_json(self)
