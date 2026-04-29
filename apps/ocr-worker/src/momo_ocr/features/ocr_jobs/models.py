from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from momo_ocr.features.ocr_results.models import OcrDraftPayload, OcrWarning
from momo_ocr.features.screen_detection.models import ImageType
from momo_ocr.shared.errors import OcrFailure


class OcrJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class OcrJobMessage:
    job_id: str
    draft_id: str
    image_id: str
    image_path: Path
    requested_image_type: ImageType
    attempt: int
    enqueued_at: str


@dataclass(frozen=True)
class OcrJobRecord:
    job_id: str
    draft_id: str
    image_id: str
    image_path: Path
    requested_image_type: ImageType
    detected_image_type: ImageType | None
    status: OcrJobStatus
    attempt_count: int
    worker_id: str | None
    failure: OcrFailure | None


@dataclass(frozen=True)
class OcrJobExecutionResult:
    status: OcrJobStatus
    draft_payload: OcrDraftPayload | None
    failure: OcrFailure | None
    warnings: list[OcrWarning]
    duration_ms: float
