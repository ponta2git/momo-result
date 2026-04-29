"""Unit tests for the OCR job runner orchestration.

These tests exercise :func:`run_one_job` against in-memory fakes for the
queue, repository, result writer, and cancellation source, and a stub
``analyze`` callable in place of the real OCR pipeline. The goal is to
validate the lifecycle, ack semantics, and hint propagation that the
production runner is responsible for, independently of any real transport.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrWarning,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_jobs.cancellation import InMemoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import InMemoryOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import (
    OcrJobHints,
    OcrJobMessage,
    OcrJobRecord,
    OcrJobStatus,
    PlayerAliasHint,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import InMemoryOcrResultWriter
from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies, run_one_job
from momo_ocr.features.ocr_results.ranked_rows import _normalize_name_for_match
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.shared.errors import FailureCode, OcrError

WORKER_ID = "worker-test"


def _make_payload(
    *,
    job_id: str = "job-1",
    draft_id: str = "draft-1",
    image_path: Path = Path("/tmp/momo/image.jpg"),
    hints_known: tuple[PlayerAliasHint, ...] = (),
    hints_layout_family: str | None = None,
) -> dict[str, str]:
    message = OcrJobMessage(
        job_id=job_id,
        draft_id=draft_id,
        image_id="image-1",
        image_path=image_path,
        requested_screen_type=ScreenType.TOTAL_ASSETS,
        attempt=1,
        enqueued_at="2025-01-01T00:00:00Z",
        hints=OcrJobHints(
            layout_family=hints_layout_family,
            known_player_aliases=hints_known,
        ),
    )
    return to_stream_payload(message)


def _seed_record(
    repo: InMemoryOcrJobRepository,
    payload: dict[str, str],
    *,
    status: OcrJobStatus = OcrJobStatus.QUEUED,
) -> None:
    msg = parse_job_message(payload)
    repo.seed(
        OcrJobRecord(
            job_id=msg.job_id,
            draft_id=msg.draft_id,
            image_id=msg.image_id,
            image_path=msg.image_path,
            requested_screen_type=msg.requested_screen_type,
            detected_screen_type=None,
            status=status,
            attempt_count=0,
            worker_id=None,
            failure=None,
        )
    )


def _success_payload() -> OcrDraftPayload:
    return OcrDraftPayload(
        requested_screen_type=ScreenType.TOTAL_ASSETS,
        detected_screen_type=ScreenType.TOTAL_ASSETS,
        profile_id="total_assets:basic",
    )


def _success_analysis(payload: OcrDraftPayload | None = None) -> AnalysisResult:
    return AnalysisResult(
        input=None,
        detection=None,
        result=payload or _success_payload(),
        warnings=[],
        failure_code=None,
        failure_message=None,
        failure_retryable=False,
        failure_user_action=None,
        timings_ms={"total": 12.0},
    )


def _failure_analysis() -> AnalysisResult:
    return AnalysisResult(
        input=None,
        detection=None,
        result=None,
        warnings=[
            OcrWarning(
                code=WarningCode.LOW_CONFIDENCE,
                message="Low confidence in row 1.",
            )
        ],
        failure_code=FailureCode.PARSER_FAILED.value,
        failure_message="Parser could not extract any rows.",
        failure_retryable=True,
        failure_user_action="Re-upload a clearer screenshot.",
        timings_ms={"total": 8.0},
    )


def _make_deps(
    *,
    consumer: InMemoryOcrJobConsumer,
    repository: InMemoryOcrJobRepository,
    result_writer: InMemoryOcrResultWriter,
    cancellation: InMemoryCancellationChecker,
    analyze: Callable[..., AnalysisResult],
    deletes: list[Path] | None = None,
) -> JobRunnerDependencies:
    def delete_image(path: Path) -> bool:
        if deletes is not None:
            deletes.append(path)
        return True

    return JobRunnerDependencies(
        consumer=consumer,
        repository=repository,
        result_writer=result_writer,
        cancellation=cancellation,
        worker_id=WORKER_ID,
        analyze=analyze,
        delete_image=delete_image,
    )


def test_run_one_job_returns_not_pulled_when_queue_is_empty() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=InMemoryCancellationChecker(),
        analyze=lambda **_: pytest.fail("analyze should not be called when queue is empty"),
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is False
    assert outcome.job_id is None
    assert outcome.status is None


def test_happy_path_persists_result_and_acks() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    result_writer = InMemoryOcrResultWriter()
    deletes: list[Path] = []

    payload = _make_payload(image_path=Path("/tmp/momo/abc.jpg"))
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=result_writer,
        cancellation=InMemoryCancellationChecker(),
        analyze=lambda **_: _success_analysis(),
        deletes=deletes,
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.SUCCEEDED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.SUCCEEDED
    assert record.worker_id == WORKER_ID
    assert record.attempt_count == 1
    assert "job-1" in result_writer.records
    assert result_writer.records["job-1"].draft_id == "draft-1"
    assert consumer.acked == ["d1"]
    assert deletes == [Path("/tmp/momo/abc.jpg")]


def test_failure_analysis_records_failed_terminal_status_with_metadata() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    result_writer = InMemoryOcrResultWriter()

    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=result_writer,
        cancellation=InMemoryCancellationChecker(),
        analyze=lambda **_: _failure_analysis(),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.PARSER_FAILED
    assert record.failure.retryable is True
    assert record.failure.user_action == "Re-upload a clearer screenshot."
    assert "job-1" not in result_writer.records
    assert consumer.acked == ["d1"]


def test_unexpected_exception_in_analyze_is_converted_to_failed_terminal() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    result_writer = InMemoryOcrResultWriter()

    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    def boom(**_: Any) -> AnalysisResult:  # noqa: ANN401
        msg = "kaboom"
        raise RuntimeError(msg)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=result_writer,
        cancellation=InMemoryCancellationChecker(),
        analyze=boom,
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.PARSER_FAILED
    assert record.failure.retryable is False
    assert consumer.acked == ["d1"]


def test_ocr_error_in_analyze_is_recorded_with_its_failure_metadata() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    def raise_ocr_error(**_: Any) -> AnalysisResult:  # noqa: ANN401
        raise OcrError(
            FailureCode.TEMP_IMAGE_MISSING,
            "image gone",
            retryable=True,
            user_action="re-upload",
        )

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=InMemoryCancellationChecker(),
        analyze=raise_ocr_error,
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.failure is not None
    assert record.failure.code is FailureCode.TEMP_IMAGE_MISSING
    assert record.failure.retryable is True
    assert record.failure.user_action == "re-upload"


def test_pre_running_cancellation_skips_analyze_and_marks_cancelled() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    cancellation = InMemoryCancellationChecker()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    cancellation.cancel("job-1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=cancellation,
        analyze=lambda **_: pytest.fail("analyze should not run for cancelled jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.CANCELLED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.CANCELLED
    assert consumer.acked == ["d1"]


def test_already_cancelled_record_is_acked_without_repository_writes() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload, status=OcrJobStatus.CANCELLED)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=InMemoryCancellationChecker(),
        analyze=lambda **_: pytest.fail("analyze should not run for terminal jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.CANCELLED
    # The seeded record stays terminal; no transitions were attempted.
    assert repository.records["job-1"].attempt_count == 0
    assert consumer.acked == ["d1"]


def test_unknown_job_id_is_acked_and_dropped() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload(job_id="unknown")
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=InMemoryCancellationChecker(),
        analyze=lambda **_: pytest.fail("analyze should not run for unknown jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.acked == ["d1"]


def test_hints_are_merged_into_alias_resolver_passed_to_analyze() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload(
        hints_layout_family="reiwa",
        hints_known=(PlayerAliasHint(member_id="ぽんた社長", aliases=("PONTAプレイヤー",)),),
    )
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    captured: dict[str, Any] = {}

    def capturing_analyze(**kwargs: Any) -> AnalysisResult:  # noqa: ANN401
        captured.update(kwargs)
        return _success_analysis()

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        result_writer=InMemoryOcrResultWriter(),
        cancellation=InMemoryCancellationChecker(),
        analyze=capturing_analyze,
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert captured["layout_family_hint"] == "reiwa"
    resolver = captured["alias_resolver"]
    # The resolver normalizes the alias surface but expects the input text to
    # already be normalized (callers in ``ranked_rows`` do that step). Mirror
    # that here so the substring match runs against comparable forms.
    canonical = resolver.resolve(_normalize_name_for_match("PONTAプレイヤー"))
    assert canonical == "ぽんた社長"
