"""Unit tests for the OCR job runner orchestration.

These tests exercise :func:`run_one_job` against in-memory fakes for the
queue, repository, result-record persistence, and cancellation source, and a stub
``analyze`` callable in place of the real OCR pipeline. The goal is to
validate the lifecycle, ack semantics, and hint propagation that the
production runner is responsible for, independently of any real transport.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path

import psycopg
import pytest

from momo_ocr.features.ocr_analysis.report import AnalysisResult
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrWarning,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker, InMemoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import InMemoryOcrJobConsumer
from momo_ocr.features.ocr_jobs.dependencies import AnalyzeImageFn, JobRunnerDependencies
from momo_ocr.features.ocr_jobs.models import (
    MaxAttemptsExceededPulledJob,
    OcrJobExecutionResult,
    OcrJobHints,
    OcrJobMessage,
    OcrJobRecord,
    OcrJobStatus,
    OcrQueueDelivery,
    PlayerAliasHint,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_jobs.runner import run_one_job
from momo_ocr.features.ocr_results.player_aliases import (
    PlayerAliasResolver,
    _normalize_name_for_match,
)
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure

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
    worker_id: str | None = None,
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
            worker_id=worker_id,
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


@dataclass
class _AnalyzeStub:
    result: AnalysisResult | None = None
    exception: BaseException | None = None
    fail_message: str | None = None
    captured: dict[str, object] = field(default_factory=dict)

    def __call__(  # noqa: PLR0913 - exact test double for AnalyzeImageFn.
        self,
        *,
        image_path: Path,
        requested_screen_type: str,
        debug_dir: Path | None,
        include_raw_text: bool,
        text_engine: TextRecognitionEngine | None = None,
        layout_family_hint: str | None = None,
        alias_resolver: PlayerAliasResolver | None = None,
        image_root: Path | None = None,
        enforce_size_limit: bool = False,
        fast_path_enabled: bool = False,
    ) -> AnalysisResult:
        self.captured = {
            "image_path": image_path,
            "requested_screen_type": requested_screen_type,
            "debug_dir": debug_dir,
            "include_raw_text": include_raw_text,
            "text_engine": text_engine,
            "layout_family_hint": layout_family_hint,
            "alias_resolver": alias_resolver,
            "image_root": image_root,
            "enforce_size_limit": enforce_size_limit,
            "fast_path_enabled": fast_path_enabled,
        }
        if self.fail_message is not None:
            pytest.fail(self.fail_message)
        if self.exception is not None:
            raise self.exception
        return self.result or _success_analysis()


class _SingleDeliveryConsumer(InMemoryOcrJobConsumer):
    def __init__(self, delivery: OcrQueueDelivery) -> None:
        super().__init__()
        self._delivery: OcrQueueDelivery | None = delivery

    def pull(self) -> OcrQueueDelivery | None:
        delivery = self._delivery
        self._delivery = None
        return delivery


def _make_deps(  # noqa: PLR0913 - test helper mirrors JobRunnerDependencies wiring.
    *,
    consumer: InMemoryOcrJobConsumer,
    repository: InMemoryOcrJobRepository,
    cancellation: CancellationChecker,
    analyze: AnalyzeImageFn,
    temp_root: Path | None = None,
    fast_path_enabled: bool = False,
    debug_dir_base: Path | None = None,
) -> JobRunnerDependencies:
    return JobRunnerDependencies(
        consumer=consumer,
        repository=repository,
        cancellation=cancellation,
        worker_id=WORKER_ID,
        analyze=analyze,
        temp_root=temp_root,
        fast_path_enabled=fast_path_enabled,
        debug_dir_base=debug_dir_base,
    )


def test_run_one_job_returns_not_pulled_when_queue_is_empty() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not be called when queue is empty"),
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is False
    assert outcome.job_id is None
    assert outcome.status is None


def test_happy_path_persists_result_and_acks() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload(image_path=Path("/tmp/momo/abc.jpg"))
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(result=_success_analysis()),
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.SUCCEEDED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.SUCCEEDED
    assert record.worker_id == WORKER_ID
    assert record.attempt_count == 1
    assert "job-1" in repository.result_records
    assert repository.result_records["job-1"].draft_id == "draft-1"
    assert consumer.acked == ["d1"]


def test_running_duplicate_delivery_is_acked_without_false_failure() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(
        repository,
        payload,
        status=OcrJobStatus.RUNNING,
        worker_id="worker-already-running",
    )
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="duplicate RUNNING delivery must not run OCR"),
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.RUNNING
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-already-running"
    assert consumer.acked == ["d1"]


class _ClaimLostRepository(InMemoryOcrJobRepository):
    def claim_for_running(self, job_id: str, *, worker_id: str) -> OcrJobRecord | None:
        del worker_id
        current = self.records.get(job_id)
        if current is None:
            return None
        raced = replace(
            current,
            status=OcrJobStatus.RUNNING,
            worker_id="worker-that-won-race",
            attempt_count=current.attempt_count + 1,
        )
        self.seed(raced)
        return raced


def test_claim_race_to_running_is_acked_without_false_failure() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = _ClaimLostRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="claim-lost duplicate must not run OCR"),
    )

    outcome = run_one_job(deps)

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.RUNNING
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-that-won-race"
    assert consumer.acked == ["d1"]


def test_success_persists_parser_payload_warnings_for_review_status() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    parser_warning = OcrWarning(
        code=WarningCode.MISSING_AMOUNT,
        message="Could not read total assets for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(
            result=_success_analysis(
                OcrDraftPayload(
                    requested_screen_type=ScreenType.TOTAL_ASSETS,
                    detected_screen_type=ScreenType.TOTAL_ASSETS,
                    profile_id="total_assets:basic",
                    warnings=[parser_warning],
                )
            )
        ),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert repository.result_records["job-1"].warnings == (parser_warning,)
    assert repository.result_records["job-1"].payload.warnings == [parser_warning]


def test_failure_analysis_records_failed_terminal_status_with_metadata() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()

    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(result=_failure_analysis()),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.PARSER_FAILED
    assert record.failure.retryable is True
    assert record.failure.user_action == "Re-upload a clearer screenshot."
    assert "job-1" not in repository.result_records
    assert consumer.acked == ["d1"]


def test_unexpected_exception_in_analyze_is_converted_to_failed_terminal() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()

    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(exception=RuntimeError("kaboom")),
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

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(
            exception=OcrError(
                FailureCode.TEMP_IMAGE_MISSING,
                "image gone",
                retryable=True,
                user_action="re-upload",
            )
        ),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.failure is not None
    assert record.failure.code is FailureCode.TEMP_IMAGE_MISSING
    assert record.failure.retryable is True
    assert record.failure.user_action == "re-upload"


class _FailingTerminalRepository(InMemoryOcrJobRepository):
    def complete_non_success(self, job_id: str, result: OcrJobExecutionResult) -> None:
        del job_id, result
        raise OcrError(FailureCode.DB_WRITE_FAILED, "db unavailable", retryable=True)


class _AdminShutdownRepository(InMemoryOcrJobRepository):
    def get_record(self, job_id: str) -> OcrJobRecord | None:
        del job_id
        message = "terminating connection due to administrator command"
        raise psycopg.errors.AdminShutdown(message)


def test_terminal_failure_write_failure_leaves_delivery_pending() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = _FailingTerminalRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(exception=OcrError(FailureCode.PARSER_FAILED, "parser failed")),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.acked == []


def test_database_shutdown_during_lookup_leaves_delivery_pending() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = _AdminShutdownRepository()
    payload = _make_payload()
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run when job lookup fails"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is None
    assert consumer.acked == []


def test_malformed_queue_payload_with_job_id_is_failed_before_ack() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    malformed = dict(payload)
    del malformed["draftId"]
    consumer.enqueue(malformed, delivery_tag="bad-1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for malformed queue payloads"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert consumer.acked == ["bad-1"]


def test_malformed_queue_payload_does_not_fail_job_owned_by_another_worker() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(
        repository,
        payload,
        status=OcrJobStatus.RUNNING,
        worker_id="worker-already-running",
    )
    malformed = dict(payload)
    del malformed["draftId"]
    consumer.enqueue(malformed, delivery_tag="bad-1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for malformed queue payloads"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-already-running"
    assert consumer.acked == ["bad-1"]


def test_malformed_queue_payload_write_failure_leaves_delivery_pending() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = _FailingTerminalRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    malformed = dict(payload)
    del malformed["draftId"]
    consumer.enqueue(malformed, delivery_tag="bad-1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for malformed queue payloads"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.acked == []


def test_max_attempts_delivery_is_failed_before_dead_letter() -> None:
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    delivery = MaxAttemptsExceededPulledJob(
        delivery_tag="stale-1",
        raw_fields=payload,
        failure=OcrFailure(
            FailureCode.QUEUE_FAILURE,
            "OCR queue delivery exceeded max attempts.",
            retryable=False,
        ),
        deliveries=2,
    )
    consumer = _SingleDeliveryConsumer(delivery)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="max-attempt deliveries must not run OCR"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert consumer.dead_letters[0][0] == "stale-1"
    assert consumer.dead_letters[0][3] == 2
    assert consumer.acked == ["stale-1"]


def test_max_attempts_failure_write_failure_leaves_delivery_pending() -> None:
    repository = _FailingTerminalRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    delivery = MaxAttemptsExceededPulledJob(
        delivery_tag="stale-1",
        raw_fields=payload,
        failure=OcrFailure(
            FailureCode.QUEUE_FAILURE,
            "OCR queue delivery exceeded max attempts.",
        ),
        deliveries=2,
    )
    consumer = _SingleDeliveryConsumer(delivery)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="max-attempt deliveries must not run OCR"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.dead_letters == []
    assert consumer.acked == []


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
        cancellation=cancellation,
        analyze=_AnalyzeStub(fail_message="analyze should not run for cancelled jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.CANCELLED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.CANCELLED
    assert consumer.acked == ["d1"]


@pytest.mark.parametrize(
    "terminal_status",
    [OcrJobStatus.SUCCEEDED, OcrJobStatus.FAILED, OcrJobStatus.CANCELLED],
)
def test_already_terminal_record_is_acked_without_repository_writes(
    terminal_status: OcrJobStatus,
) -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload, status=terminal_status)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for terminal jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is terminal_status
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
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for unknown jobs"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.acked == ["d1"]


def test_queue_payload_mismatch_with_db_record_is_failed_before_analyze() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload(image_path=Path("/tmp/momo/message.jpg"))
    _seed_record(repository, payload)
    repository.seed(
        replace(
            repository.records["job-1"],
            draft_id="draft-from-db",
            image_id="image-from-db",
            image_path=Path("/tmp/momo/db.jpg"),
            requested_screen_type=ScreenType.REVENUE,
        )
    )
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(fail_message="analyze should not run for payload/DB mismatches"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.FAILED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.FAILED
    assert record.attempt_count == 1
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert "draftId" in record.failure.message
    assert "imageId" in record.failure.message
    assert "imagePath" in record.failure.message
    assert "requestedScreenType" in record.failure.message
    assert "job-1" not in repository.result_records
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

    analyze = _AnalyzeStub(result=_success_analysis())

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=analyze,
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert analyze.captured["layout_family_hint"] == "reiwa"
    resolver = analyze.captured["alias_resolver"]
    assert isinstance(resolver, PlayerAliasResolver)
    # The resolver normalizes the alias surface but expects the input text to
    # already be normalized (callers in ``player_aliases`` do that step). Mirror
    # that here so the substring match runs against comparable forms.
    match = resolver.resolve(_normalize_name_for_match("PONTAプレイヤー"))
    assert match is not None
    assert match.display_name == "PONTAプレイヤー"
    assert match.member_id == "ぽんた社長"


def test_worker_analyze_enforces_temp_root_and_upload_size_limit(tmp_path: Path) -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    image_root = tmp_path / "uploads"
    debug_dir_base = tmp_path / "debug"
    image_root.mkdir()
    image_path = image_root / "abc.jpg"
    payload = _make_payload(image_path=image_path)
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    analyze = _AnalyzeStub(result=_success_analysis())

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=analyze,
        temp_root=image_root,
        fast_path_enabled=True,
        debug_dir_base=debug_dir_base,
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert analyze.captured["image_root"] == image_root
    assert analyze.captured["enforce_size_limit"] is True
    assert analyze.captured["fast_path_enabled"] is True
    debug_dir = analyze.captured["debug_dir"]
    assert isinstance(debug_dir, Path)
    assert debug_dir == debug_dir_base / "abc__job-1"
    assert debug_dir.is_dir()


class _ToggleAfterFirstCallCancellation:
    """Cancellation appears only after ``threshold`` is_cancelled calls.

    Used to simulate a CANCELLED status that becomes visible *between*
    the running claim and ``analyze`` so we can pin the post-running
    cancellation phase.
    """

    def __init__(self, job_id: str, *, threshold: int = 2) -> None:
        self._job_id = job_id
        self._threshold = threshold
        self._calls = 0

    def is_cancelled(self, job_id: str) -> bool:
        if job_id != self._job_id:
            return False
        self._calls += 1
        return self._calls >= self._threshold


class _RepositoryCancellationOnCall:
    """Simulate API-side cancellation becoming terminal in the DB."""

    def __init__(
        self,
        repository: InMemoryOcrJobRepository,
        job_id: str,
        *,
        threshold: int,
    ) -> None:
        self._repository = repository
        self._job_id = job_id
        self._threshold = threshold
        self._calls = 0

    def is_cancelled(self, job_id: str) -> bool:
        if job_id != self._job_id:
            return False
        self._calls += 1
        if self._calls < self._threshold:
            return False
        current = self._repository.records[job_id]
        self._repository.seed(replace(current, status=OcrJobStatus.CANCELLED))
        return True


class _AckObserverConsumer(InMemoryOcrJobConsumer):
    def __init__(self, repository: InMemoryOcrJobRepository, job_id: str) -> None:
        super().__init__()
        self._repository = repository
        self._job_id = job_id
        self.observed_status_at_ack: list[OcrJobStatus | None] = []

    def ack(self, delivery_tag: str) -> None:
        self.observed_status_at_ack.append(self._repository.records[self._job_id].status)
        super().ack(delivery_tag)


def test_post_running_cancellation_is_honoured_before_analyze() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    cancellation = _ToggleAfterFirstCallCancellation("job-1", threshold=2)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=cancellation,
        analyze=_AnalyzeStub(
            fail_message="analyze must not run when cancellation appears post-running"
        ),
    )

    outcome = run_one_job(deps)

    # State machine invariant: even if the pre-running check passed
    # (first is_cancelled returned False), the post-running check
    # observes cancellation and aborts before analyze.
    assert outcome.status is OcrJobStatus.CANCELLED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.CANCELLED
    # Ack still happens after the terminal status is recorded.
    assert consumer.acked == ["d1"]


def test_pre_running_db_cancel_race_is_acked_without_false_failure() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    cancellation = _RepositoryCancellationOnCall(repository, "job-1", threshold=1)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=cancellation,
        analyze=_AnalyzeStub(fail_message="analyze must not run after DB-side cancellation"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.CANCELLED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.CANCELLED
    assert record.failure is None
    assert record.attempt_count == 0
    assert consumer.acked == ["d1"]


def test_post_running_db_cancel_race_is_acked_without_false_failure() -> None:
    consumer = InMemoryOcrJobConsumer()
    repository = InMemoryOcrJobRepository()
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")
    cancellation = _RepositoryCancellationOnCall(repository, "job-1", threshold=2)

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=cancellation,
        analyze=_AnalyzeStub(fail_message="analyze must not run after DB-side cancellation"),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.CANCELLED
    record = repository.records["job-1"]
    assert record.status is OcrJobStatus.CANCELLED
    assert record.failure is None
    assert record.worker_id == WORKER_ID
    assert record.attempt_count == 1
    assert consumer.acked == ["d1"]


def test_ack_runs_only_after_terminal_status_is_persisted() -> None:
    """Invariant: the queue ack must observe a terminal repository status."""
    repository = InMemoryOcrJobRepository()
    consumer = _AckObserverConsumer(repository, "job-1")
    payload = _make_payload()
    _seed_record(repository, payload)
    consumer.enqueue(payload, delivery_tag="d1")

    deps = _make_deps(
        consumer=consumer,
        repository=repository,
        cancellation=InMemoryCancellationChecker(),
        analyze=_AnalyzeStub(result=_success_analysis()),
    )

    outcome = run_one_job(deps)

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert consumer.observed_status_at_ack == [OcrJobStatus.SUCCEEDED]
