from __future__ import annotations

import pytest

from momo_ocr.features.ocr_domain.models import OcrDraftPayload
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.shared.errors import FailureCode, OcrError
from tests.support.ocr_jobs import make_job_record, success_draft_payload


def test_complete_success_rejects_result_status_mismatch() -> None:
    repository = _running_repository()
    payload = _payload()

    with pytest.raises(OcrError) as error:
        repository.complete_success(
            "job-1",
            _result_record(payload),
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=payload,
                failure=None,
                warnings=[],
                duration_ms=1.0,
            ),
        )

    assert error.value.code is FailureCode.DB_WRITE_FAILED
    assert repository.records["job-1"].status is OcrJobStatus.RUNNING


def test_complete_success_rejects_payload_mismatch() -> None:
    repository = _running_repository()
    payload = _payload(profile_id="record-payload")

    with pytest.raises(OcrError, match="same payload"):
        repository.complete_success(
            "job-1",
            _result_record(payload),
            OcrJobExecutionResult(
                status=OcrJobStatus.SUCCEEDED,
                draft_payload=_payload(profile_id="reported-payload"),
                failure=None,
                warnings=[],
                duration_ms=1.0,
            ),
        )


def test_failed_terminal_requires_failure_metadata() -> None:
    repository = _running_repository()

    with pytest.raises(OcrError, match="requires failure metadata"):
        repository.complete_non_success(
            "job-1",
            OcrJobExecutionResult(
                status=OcrJobStatus.FAILED,
                draft_payload=None,
                failure=None,
                warnings=[],
                duration_ms=1.0,
            ),
        )


def _running_repository() -> InMemoryOcrJobRepository:
    repository = InMemoryOcrJobRepository()
    repository.seed(make_job_record(status=OcrJobStatus.RUNNING, worker_id="worker-1"))
    return repository


def _payload(*, profile_id: str = "profile-1") -> OcrDraftPayload:
    return success_draft_payload(profile_id=profile_id)


def _result_record(payload: OcrDraftPayload) -> OcrResultRecord:
    return OcrResultRecord(
        job_id="job-1",
        draft_id="draft-1",
        payload=payload,
        warnings=(),
        timings_ms={},
    )
