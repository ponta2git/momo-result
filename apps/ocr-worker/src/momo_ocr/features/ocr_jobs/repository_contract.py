from __future__ import annotations

from typing import Protocol

from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
)
from momo_ocr.features.ocr_jobs.result_records import OcrResultRecord
from momo_ocr.shared.errors import FailureCode, OcrError


class OcrJobRepository(Protocol):
    def get_record(self, job_id: str) -> OcrJobRecord | None:
        raise NotImplementedError

    def claim_for_running(self, job_id: str, *, worker_id: str) -> OcrJobRecord | None:
        """Atomically claim a queued job, returning the canonical post-claim row.

        Expected races are represented as the current DB row instead of an
        exception: callers can ack duplicates for RUNNING/terminal jobs without
        accidentally writing a false terminal failure.
        """
        raise NotImplementedError

    def complete_success(
        self,
        job_id: str,
        result_record: OcrResultRecord,
        result: OcrJobExecutionResult,
    ) -> None:
        raise NotImplementedError

    def complete_non_success(self, job_id: str, result: OcrJobExecutionResult) -> None:
        raise NotImplementedError

    def get_status(self, job_id: str) -> OcrJobStatus | None:
        raise NotImplementedError


def ensure_success_result(
    result_record: OcrResultRecord,
    result: OcrJobExecutionResult,
) -> None:
    if result.draft_payload != result_record.payload:
        raise OcrError(
            FailureCode.DB_WRITE_FAILED,
            "Successful OCR completion must persist the same payload it reports.",
        )
    ensure_terminal_result(result, OcrJobStatus.SUCCEEDED)


def ensure_non_success_result(result: OcrJobExecutionResult) -> None:
    if result.status not in {OcrJobStatus.FAILED, OcrJobStatus.CANCELLED}:
        raise OcrError(
            FailureCode.DB_WRITE_FAILED,
            f"Non-success completion received success status: {result.status.value}.",
        )
    ensure_terminal_result(result, result.status)


def ensure_terminal_result(result: OcrJobExecutionResult, expected: OcrJobStatus) -> None:
    if result.status is not expected:
        raise OcrError(
            FailureCode.DB_WRITE_FAILED,
            (
                "OCR execution result status does not match terminal transition: "
                f"{result.status.value} != {expected.value}."
            ),
        )
    if expected is OcrJobStatus.SUCCEEDED:
        if result.draft_payload is None or result.failure is not None:
            raise OcrError(
                FailureCode.DB_WRITE_FAILED,
                "Successful OCR completion requires a draft payload and no failure.",
            )
        return
    if expected is OcrJobStatus.FAILED and result.failure is None:
        raise OcrError(
            FailureCode.DB_WRITE_FAILED,
            "Failed OCR completion requires failure metadata.",
        )
    if result.draft_payload is not None:
        raise OcrError(
            FailureCode.DB_WRITE_FAILED,
            "Non-success OCR completion must not include a draft payload.",
        )
