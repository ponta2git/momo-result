from __future__ import annotations

from pathlib import Path

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobMessage
from momo_ocr.shared.errors import FailureCode, OcrError

STREAM_PAYLOAD_KEYS = {
    "jobId",
    "draftId",
    "imageId",
    "imagePath",
    "requestedImageType",
    "attempt",
    "enqueuedAt",
}


def parse_job_message(payload: dict[str, str]) -> OcrJobMessage:
    missing_keys = STREAM_PAYLOAD_KEYS - payload.keys()
    if missing_keys:
        missing = ", ".join(sorted(missing_keys))
        raise OcrError(FailureCode.QUEUE_FAILURE, f"OCR queue message is missing keys: {missing}")

    try:
        requested_screen_type = ScreenType(payload["requestedImageType"])
    except ValueError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            f"Unsupported requestedImageType in OCR queue message: {payload['requestedImageType']}",
        ) from exc

    try:
        attempt = int(payload["attempt"])
    except ValueError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            "OCR queue message attempt must be an integer.",
        ) from exc

    if attempt < 1:
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue message attempt must be positive.")

    return OcrJobMessage(
        job_id=payload["jobId"],
        draft_id=payload["draftId"],
        image_id=payload["imageId"],
        image_path=Path(payload["imagePath"]),
        requested_screen_type=requested_screen_type,
        attempt=attempt,
        enqueued_at=payload["enqueuedAt"],
    )


def to_stream_payload(message: OcrJobMessage) -> dict[str, str]:
    return {
        "jobId": message.job_id,
        "draftId": message.draft_id,
        "imageId": message.image_id,
        "imagePath": str(message.image_path),
        "requestedImageType": message.requested_screen_type.value,
        "attempt": str(message.attempt),
        "enqueuedAt": message.enqueued_at,
    }
