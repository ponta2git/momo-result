"""Unit tests for the OCR job runner orchestration.

These tests exercise :func:`run_one_job` against in-memory fakes for the
queue, repository, result-record persistence, and cancellation source, and a stub
``analyze`` callable in place of the real OCR pipeline. The goal is to
validate the lifecycle, ack semantics, and hint propagation that the
production runner is responsible for, independently of any real transport.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import psycopg
import pytest

from momo_ocr.features.ocr_domain.models import (
    OcrWarning,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_jobs.cancellation import InMemoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import InMemoryOcrJobConsumer
from momo_ocr.features.ocr_jobs.models import (
    OcrJobExecutionResult,
    OcrJobRecord,
    OcrJobStatus,
    PlayerAliasHint,
)
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_results.player_aliases import (
    PlayerAliasResolver,
    _normalize_name_for_match,
)
from momo_ocr.shared.errors import FailureCode, OcrError, OcrFailure
from tests.support.ocr_jobs import (
    WORKER_ID,
    AnalyzeStub,
    RunnerHarness,
    SingleDeliveryConsumer,
    make_stream_payload,
    max_attempts_delivery,
    parser_failure_analysis,
    seed_job_record,
    success_draft_payload,
    successful_analysis,
)


def test_run_one_job_returns_not_pulled_when_queue_is_empty() -> None:
    harness = RunnerHarness(
        analyze=AnalyzeStub(fail_message="analyze should not be called when queue is empty")
    )

    outcome = harness.run()

    assert outcome.pulled is False
    assert outcome.job_id is None
    assert outcome.status is None


def test_happy_path_persists_result_and_acks() -> None:
    harness = RunnerHarness.with_seeded_delivery(
        payload=make_stream_payload(image_path=Path("/tmp/momo/abc.jpg")),
        analyze=AnalyzeStub(result=successful_analysis()),
    )

    outcome = harness.run()

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.SUCCEEDED
    record = harness.record()
    assert record.status is OcrJobStatus.SUCCEEDED
    assert record.worker_id == WORKER_ID
    assert record.attempt_count == 1
    assert "job-1" in harness.repository.result_records
    assert harness.repository.result_records["job-1"].draft_id == "draft-1"
    assert harness.consumer.acked == ["d1"]


def test_running_duplicate_delivery_is_acked_without_false_failure() -> None:
    harness = RunnerHarness.with_seeded_delivery(
        status=OcrJobStatus.RUNNING,
        worker_id="worker-already-running",
        analyze=AnalyzeStub(fail_message="duplicate RUNNING delivery must not run OCR"),
    )

    outcome = harness.run()

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.RUNNING
    record = harness.record()
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-already-running"
    assert harness.consumer.acked == ["d1"]


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
    harness = RunnerHarness.with_seeded_delivery(
        repository=_ClaimLostRepository(),
        analyze=AnalyzeStub(fail_message="claim-lost duplicate must not run OCR"),
    )

    outcome = harness.run()

    assert outcome.pulled is True
    assert outcome.status is OcrJobStatus.RUNNING
    record = harness.record()
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-that-won-race"
    assert harness.consumer.acked == ["d1"]


def test_success_persists_parser_payload_warnings_for_review_status() -> None:
    parser_warning = OcrWarning(
        code=WarningCode.MISSING_AMOUNT,
        message="Could not read total assets for rank 1.",
        field_path="players[0].total_assets_man_yen",
    )
    harness = RunnerHarness.with_seeded_delivery(
        analyze=AnalyzeStub(
            result=successful_analysis(
                success_draft_payload(warnings=[parser_warning]),
            ),
        ),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert harness.repository.result_records["job-1"].warnings == (parser_warning,)
    assert harness.repository.result_records["job-1"].payload.warnings == [parser_warning]


def test_failure_analysis_records_failed_terminal_status_with_metadata() -> None:
    harness = RunnerHarness.with_seeded_delivery(
        analyze=AnalyzeStub(result=parser_failure_analysis())
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.PARSER_FAILED
    assert record.failure.retryable is True
    assert record.failure.user_action == "Re-upload a clearer screenshot."
    assert "job-1" not in harness.repository.result_records
    assert harness.consumer.acked == ["d1"]


def test_unexpected_exception_in_analyze_is_converted_to_failed_terminal() -> None:
    harness = RunnerHarness.with_seeded_delivery(
        analyze=AnalyzeStub(exception=RuntimeError("kaboom"))
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.PARSER_FAILED
    assert record.failure.retryable is False
    assert harness.consumer.acked == ["d1"]


def test_ocr_error_in_analyze_is_recorded_with_its_failure_metadata() -> None:
    harness = RunnerHarness.with_seeded_delivery(
        analyze=AnalyzeStub(
            exception=OcrError(
                FailureCode.TEMP_IMAGE_MISSING,
                "image gone",
                retryable=True,
                user_action="re-upload",
            )
        ),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
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
    harness = RunnerHarness.with_seeded_delivery(
        repository=_FailingTerminalRepository(),
        analyze=AnalyzeStub(exception=OcrError(FailureCode.PARSER_FAILED, "parser failed")),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    assert harness.consumer.acked == []


def test_database_shutdown_during_lookup_leaves_delivery_pending() -> None:
    harness = RunnerHarness(
        repository=_AdminShutdownRepository(),
        analyze=AnalyzeStub(fail_message="analyze should not run when job lookup fails"),
    )
    harness.enqueue(make_stream_payload())

    outcome = harness.run()

    assert outcome.status is None
    assert harness.consumer.acked == []


def test_malformed_queue_payload_with_job_id_is_failed_before_ack() -> None:
    harness = RunnerHarness()
    payload = make_stream_payload()
    harness.seed(payload)
    malformed = dict(payload)
    del malformed["draftId"]
    harness.enqueue(malformed, delivery_tag="bad-1")

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert harness.consumer.acked == ["bad-1"]


def test_malformed_queue_payload_does_not_fail_job_owned_by_another_worker() -> None:
    harness = RunnerHarness()
    payload = make_stream_payload()
    harness.seed(
        payload,
        status=OcrJobStatus.RUNNING,
        worker_id="worker-already-running",
    )
    malformed = dict(payload)
    del malformed["draftId"]
    harness.enqueue(malformed, delivery_tag="bad-1")

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.RUNNING
    assert record.failure is None
    assert record.worker_id == "worker-already-running"
    assert harness.consumer.acked == ["bad-1"]


def test_malformed_queue_payload_write_failure_leaves_delivery_pending() -> None:
    harness = RunnerHarness(repository=_FailingTerminalRepository())
    payload = make_stream_payload()
    harness.seed(payload)
    malformed = dict(payload)
    del malformed["draftId"]
    harness.enqueue(malformed, delivery_tag="bad-1")

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    assert harness.consumer.acked == []


def test_max_attempts_delivery_is_failed_before_dead_letter() -> None:
    repository = InMemoryOcrJobRepository()
    payload = make_stream_payload()
    seed_job_record(repository, payload)
    consumer = SingleDeliveryConsumer(max_attempts_delivery(payload))
    harness = RunnerHarness(
        consumer=consumer,
        repository=repository,
        analyze=AnalyzeStub(fail_message="max-attempt deliveries must not run OCR"),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.FAILED
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert consumer.dead_letters[0][0] == "stale-1"
    assert consumer.dead_letters[0][3] == 2
    assert consumer.acked == ["stale-1"]


def test_max_attempts_failure_write_failure_leaves_delivery_pending() -> None:
    repository = _FailingTerminalRepository()
    payload = make_stream_payload()
    seed_job_record(repository, payload)
    consumer = SingleDeliveryConsumer(
        max_attempts_delivery(
            payload,
            failure=OcrFailure(
                FailureCode.QUEUE_FAILURE,
                "OCR queue delivery exceeded max attempts.",
            ),
        )
    )
    harness = RunnerHarness(
        consumer=consumer,
        repository=repository,
        analyze=AnalyzeStub(fail_message="max-attempt deliveries must not run OCR"),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    assert consumer.dead_letters == []
    assert consumer.acked == []


def test_pre_running_cancellation_skips_analyze_and_marks_cancelled() -> None:
    cancellation = InMemoryCancellationChecker()
    cancellation.cancel("job-1")
    harness = RunnerHarness.with_seeded_delivery(
        cancellation=cancellation,
        analyze=AnalyzeStub(fail_message="analyze should not run for cancelled jobs"),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.CANCELLED
    record = harness.record()
    assert record.status is OcrJobStatus.CANCELLED
    assert harness.consumer.acked == ["d1"]


@pytest.mark.parametrize(
    "terminal_status",
    [OcrJobStatus.SUCCEEDED, OcrJobStatus.FAILED, OcrJobStatus.CANCELLED],
)
def test_already_terminal_record_is_acked_without_repository_writes(
    terminal_status: OcrJobStatus,
) -> None:
    harness = RunnerHarness.with_seeded_delivery(
        status=terminal_status,
        analyze=AnalyzeStub(fail_message="analyze should not run for terminal jobs"),
    )

    outcome = harness.run()

    assert outcome.status is terminal_status
    # The seeded record stays terminal; no transitions were attempted.
    assert harness.record().attempt_count == 0
    assert harness.consumer.acked == ["d1"]


def test_unknown_job_id_is_acked_and_dropped() -> None:
    harness = RunnerHarness(
        analyze=AnalyzeStub(fail_message="analyze should not run for unknown jobs")
    )
    harness.enqueue(make_stream_payload(job_id="unknown"))

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    assert harness.consumer.acked == ["d1"]


def test_queue_payload_mismatch_with_db_record_is_failed_before_analyze() -> None:
    payload = make_stream_payload(image_path=Path("/tmp/momo/message.jpg"))
    harness = RunnerHarness.with_seeded_delivery(
        payload=payload,
        analyze=AnalyzeStub(fail_message="analyze should not run for payload/DB mismatches"),
    )
    harness.repository.seed(
        replace(
            harness.record(),
            draft_id="draft-from-db",
            image_id="image-from-db",
            image_path=Path("/tmp/momo/db.jpg"),
            requested_screen_type=ScreenType.REVENUE,
        )
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.FAILED
    record = harness.record()
    assert record.status is OcrJobStatus.FAILED
    assert record.attempt_count == 1
    assert record.failure is not None
    assert record.failure.code is FailureCode.QUEUE_FAILURE
    assert "draftId" in record.failure.message
    assert "imageId" in record.failure.message
    assert "imagePath" in record.failure.message
    assert "requestedScreenType" in record.failure.message
    assert "job-1" not in harness.repository.result_records
    assert harness.consumer.acked == ["d1"]


def test_hints_are_merged_into_alias_resolver_passed_to_analyze() -> None:
    analyze = AnalyzeStub(result=successful_analysis())
    harness = RunnerHarness.with_seeded_delivery(
        payload=make_stream_payload(
            layout_family="reiwa",
            known_player_aliases=(
                PlayerAliasHint(member_id="ぽんた社長", aliases=("PONTAプレイヤー",)),
            ),
        ),
        analyze=analyze,
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert analyze.last_call.layout_family_hint == "reiwa"
    resolver = analyze.last_call.alias_resolver
    assert isinstance(resolver, PlayerAliasResolver)
    # The resolver normalizes the alias surface but expects the input text to
    # already be normalized (callers in ``player_aliases`` do that step). Mirror
    # that here so the substring match runs against comparable forms.
    match = resolver.resolve(_normalize_name_for_match("PONTAプレイヤー"))
    assert match is not None
    assert match.display_name == "PONTAプレイヤー"
    assert match.member_id == "ぽんた社長"


def test_worker_analyze_enforces_temp_root_and_upload_size_limit(tmp_path: Path) -> None:
    image_root = tmp_path / "uploads"
    debug_dir_base = tmp_path / "debug"
    image_root.mkdir()
    image_path = image_root / "abc.jpg"
    analyze = AnalyzeStub(result=successful_analysis())
    harness = RunnerHarness.with_seeded_delivery(
        payload=make_stream_payload(image_path=image_path),
        analyze=analyze,
        temp_root=image_root,
        fast_path_enabled=True,
        debug_dir_base=debug_dir_base,
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert analyze.last_call.image_root == image_root
    assert analyze.last_call.enforce_size_limit is True
    assert analyze.last_call.fast_path_enabled is True
    debug_dir = analyze.last_call.debug_dir
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
    cancellation = _ToggleAfterFirstCallCancellation("job-1", threshold=2)
    harness = RunnerHarness.with_seeded_delivery(
        cancellation=cancellation,
        analyze=AnalyzeStub(
            fail_message="analyze must not run when cancellation appears post-running"
        ),
    )

    outcome = harness.run()

    # State machine invariant: even if the pre-running check passed
    # (first is_cancelled returned False), the post-running check
    # observes cancellation and aborts before analyze.
    assert outcome.status is OcrJobStatus.CANCELLED
    record = harness.record()
    assert record.status is OcrJobStatus.CANCELLED
    # Ack still happens after the terminal status is recorded.
    assert harness.consumer.acked == ["d1"]


def test_pre_running_db_cancel_race_is_acked_without_false_failure() -> None:
    repository = InMemoryOcrJobRepository()
    cancellation = _RepositoryCancellationOnCall(repository, "job-1", threshold=1)
    harness = RunnerHarness.with_seeded_delivery(
        repository=repository,
        cancellation=cancellation,
        analyze=AnalyzeStub(fail_message="analyze must not run after DB-side cancellation"),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.CANCELLED
    record = harness.record()
    assert record.status is OcrJobStatus.CANCELLED
    assert record.failure is None
    assert record.attempt_count == 0
    assert harness.consumer.acked == ["d1"]


def test_post_running_db_cancel_race_is_acked_without_false_failure() -> None:
    repository = InMemoryOcrJobRepository()
    cancellation = _RepositoryCancellationOnCall(repository, "job-1", threshold=2)
    harness = RunnerHarness.with_seeded_delivery(
        repository=repository,
        cancellation=cancellation,
        analyze=AnalyzeStub(fail_message="analyze must not run after DB-side cancellation"),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.CANCELLED
    record = harness.record()
    assert record.status is OcrJobStatus.CANCELLED
    assert record.failure is None
    assert record.worker_id == WORKER_ID
    assert record.attempt_count == 1
    assert harness.consumer.acked == ["d1"]


def test_ack_runs_only_after_terminal_status_is_persisted() -> None:
    """Invariant: the queue ack must observe a terminal repository status."""
    repository = InMemoryOcrJobRepository()
    consumer = _AckObserverConsumer(repository, "job-1")
    harness = RunnerHarness.with_seeded_delivery(
        consumer=consumer,
        repository=repository,
        analyze=AnalyzeStub(result=successful_analysis()),
    )

    outcome = harness.run()

    assert outcome.status is OcrJobStatus.SUCCEEDED
    assert consumer.observed_status_at_ack == [OcrJobStatus.SUCCEEDED]
