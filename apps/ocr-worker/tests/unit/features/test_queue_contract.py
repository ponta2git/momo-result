from __future__ import annotations

from pathlib import Path

import pytest

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobMessage
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.shared.errors import OcrError


def test_parse_job_message_uses_api_contract_keys() -> None:
    message = parse_job_message(
        {
            "jobId": "job-1",
            "draftId": "draft-1",
            "imageId": "image-1",
            "imagePath": "/tmp/sample.jpg",
            "requestedImageType": "total_assets",
            "attempt": "2",
            "enqueuedAt": "2026-04-29T10:00:00Z",
        }
    )

    assert message.job_id == "job-1"
    assert message.requested_screen_type == ScreenType.TOTAL_ASSETS
    assert message.attempt == 2


def test_job_message_round_trips_to_api_payload_keys() -> None:
    payload = to_stream_payload(
        OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/sample.jpg"),
            requested_screen_type=ScreenType.REVENUE,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
        )
    )

    assert payload == {
        "jobId": "job-1",
        "draftId": "draft-1",
        "imageId": "image-1",
        "imagePath": "/tmp/sample.jpg",
        "requestedImageType": "revenue",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
    }
    assert parse_job_message(payload).requested_screen_type == ScreenType.REVENUE


def test_parse_job_message_rejects_missing_required_keys() -> None:
    with pytest.raises(OcrError) as error:
        parse_job_message({"jobId": "job-1"})

    assert error.value.code.value == "QUEUE_FAILURE"
    assert "draftId" in error.value.message
