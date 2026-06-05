from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Self

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
    OcrJobHints,
    OcrJobMessage,
    OcrJobRecord,
    OcrJobStatus,
    OcrQueueDelivery,
    PlayerAliasHint,
)
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.ocr_jobs.runner import JobRunOutcome, run_one_job
from momo_ocr.features.ocr_results.player_aliases import PlayerAliasResolver
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.shared.errors import FailureCode, OcrFailure

WORKER_ID = "worker-test"


def make_job_message(  # noqa: PLR0913 - factory mirrors the queue message contract.
    *,
    job_id: str = "job-1",
    draft_id: str = "draft-1",
    image_id: str = "image-1",
    image_path: Path = Path("/tmp/momo/image.jpg"),
    requested_screen_type: ScreenType = ScreenType.TOTAL_ASSETS,
    attempt: int = 1,
    enqueued_at: str = "2025-01-01T00:00:00Z",
    hints: OcrJobHints | None = None,
    request_id: str | None = None,
) -> OcrJobMessage:
    return OcrJobMessage(
        job_id=job_id,
        draft_id=draft_id,
        image_id=image_id,
        image_path=image_path,
        requested_screen_type=requested_screen_type,
        attempt=attempt,
        enqueued_at=enqueued_at,
        hints=hints or OcrJobHints(),
        request_id=request_id,
    )


def make_stream_payload(  # noqa: PLR0913 - factory mirrors the stream payload contract.
    *,
    job_id: str = "job-1",
    draft_id: str = "draft-1",
    image_id: str = "image-1",
    image_path: Path = Path("/tmp/momo/image.jpg"),
    requested_screen_type: ScreenType = ScreenType.TOTAL_ASSETS,
    attempt: int = 1,
    enqueued_at: str = "2025-01-01T00:00:00Z",
    known_player_aliases: tuple[PlayerAliasHint, ...] = (),
    layout_family: str | None = None,
    request_id: str | None = None,
) -> dict[str, str]:
    return to_stream_payload(
        make_job_message(
            job_id=job_id,
            draft_id=draft_id,
            image_id=image_id,
            image_path=image_path,
            requested_screen_type=requested_screen_type,
            attempt=attempt,
            enqueued_at=enqueued_at,
            hints=OcrJobHints(
                layout_family=layout_family,
                known_player_aliases=known_player_aliases,
            ),
            request_id=request_id,
        )
    )


def make_job_record(
    payload: dict[str, str] | None = None,
    *,
    status: OcrJobStatus = OcrJobStatus.QUEUED,
    worker_id: str | None = None,
    detected_screen_type: ScreenType | None = None,
    failure: OcrFailure | None = None,
) -> OcrJobRecord:
    message = parse_job_message(payload or make_stream_payload())
    return OcrJobRecord(
        job_id=message.job_id,
        draft_id=message.draft_id,
        image_id=message.image_id,
        image_path=message.image_path,
        requested_screen_type=message.requested_screen_type,
        detected_screen_type=detected_screen_type,
        status=status,
        attempt_count=0,
        worker_id=worker_id,
        failure=failure,
    )


def seed_job_record(
    repository: InMemoryOcrJobRepository,
    payload: dict[str, str] | None = None,
    *,
    status: OcrJobStatus = OcrJobStatus.QUEUED,
    worker_id: str | None = None,
) -> OcrJobRecord:
    record = make_job_record(payload, status=status, worker_id=worker_id)
    repository.seed(record)
    return record


def success_draft_payload(
    *,
    requested_screen_type: ScreenType = ScreenType.TOTAL_ASSETS,
    detected_screen_type: ScreenType = ScreenType.TOTAL_ASSETS,
    profile_id: str = "total_assets:basic",
    warnings: list[OcrWarning] | None = None,
) -> OcrDraftPayload:
    return OcrDraftPayload(
        requested_screen_type=requested_screen_type,
        detected_screen_type=detected_screen_type,
        profile_id=profile_id,
        warnings=warnings or [],
    )


def successful_analysis(
    payload: OcrDraftPayload | None = None,
    *,
    warnings: list[OcrWarning] | None = None,
    timings_ms: dict[str, float] | None = None,
) -> AnalysisResult:
    return AnalysisResult(
        input=None,
        detection=None,
        result=payload or success_draft_payload(),
        warnings=warnings or [],
        failure_code=None,
        failure_message=None,
        failure_retryable=False,
        failure_user_action=None,
        timings_ms=timings_ms or {"total": 12.0},
    )


def parser_failure_analysis() -> AnalysisResult:
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


@dataclass(frozen=True)
class AnalyzeCall:
    image_path: Path
    requested_screen_type: str
    debug_dir: Path | None
    include_raw_text: bool
    text_engine: TextRecognitionEngine | None
    layout_family_hint: str | None
    alias_resolver: PlayerAliasResolver | None
    image_root: Path | None
    enforce_size_limit: bool
    fast_path_enabled: bool


@dataclass
class AnalyzeStub:
    result: AnalysisResult | None = None
    exception: BaseException | None = None
    fail_message: str | None = None
    calls: list[AnalyzeCall] = field(default_factory=list)

    @property
    def last_call(self) -> AnalyzeCall:
        return self.calls[-1]

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
        self.calls.append(
            AnalyzeCall(
                image_path=image_path,
                requested_screen_type=requested_screen_type,
                debug_dir=debug_dir,
                include_raw_text=include_raw_text,
                text_engine=text_engine,
                layout_family_hint=layout_family_hint,
                alias_resolver=alias_resolver,
                image_root=image_root,
                enforce_size_limit=enforce_size_limit,
                fast_path_enabled=fast_path_enabled,
            )
        )
        if self.fail_message is not None:
            pytest.fail(self.fail_message)
        if self.exception is not None:
            raise self.exception
        return self.result or successful_analysis()


class SingleDeliveryConsumer(InMemoryOcrJobConsumer):
    def __init__(self, delivery: OcrQueueDelivery) -> None:
        super().__init__()
        self._delivery: OcrQueueDelivery | None = delivery

    def pull(self) -> OcrQueueDelivery | None:
        delivery = self._delivery
        self._delivery = None
        return delivery


def max_attempts_delivery(
    payload: dict[str, str],
    *,
    delivery_tag: str = "stale-1",
    failure: OcrFailure | None = None,
    deliveries: int = 2,
) -> MaxAttemptsExceededPulledJob:
    return MaxAttemptsExceededPulledJob(
        delivery_tag=delivery_tag,
        raw_fields=payload,
        failure=failure
        or OcrFailure(
            FailureCode.QUEUE_FAILURE,
            "OCR queue delivery exceeded max attempts.",
            retryable=False,
        ),
        deliveries=deliveries,
    )


def make_runner_dependencies(  # noqa: PLR0913 - test helper mirrors production wiring.
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


@dataclass
class RunnerHarness:
    consumer: InMemoryOcrJobConsumer = field(default_factory=InMemoryOcrJobConsumer)
    repository: InMemoryOcrJobRepository = field(default_factory=InMemoryOcrJobRepository)
    cancellation: CancellationChecker = field(default_factory=InMemoryCancellationChecker)
    analyze: AnalyzeStub = field(default_factory=AnalyzeStub)
    temp_root: Path | None = None
    fast_path_enabled: bool = False
    debug_dir_base: Path | None = None

    @classmethod
    def with_seeded_delivery(  # noqa: PLR0913 - scenario builder mirrors runner wiring.
        cls,
        *,
        payload: dict[str, str] | None = None,
        delivery_tag: str = "d1",
        status: OcrJobStatus = OcrJobStatus.QUEUED,
        worker_id: str | None = None,
        consumer: InMemoryOcrJobConsumer | None = None,
        repository: InMemoryOcrJobRepository | None = None,
        cancellation: CancellationChecker | None = None,
        analyze: AnalyzeStub | None = None,
        temp_root: Path | None = None,
        fast_path_enabled: bool = False,
        debug_dir_base: Path | None = None,
    ) -> Self:
        resolved_payload = payload or make_stream_payload()
        resolved_consumer = consumer or InMemoryOcrJobConsumer()
        resolved_repository = repository or InMemoryOcrJobRepository()
        seed_job_record(
            resolved_repository,
            resolved_payload,
            status=status,
            worker_id=worker_id,
        )
        resolved_consumer.enqueue(resolved_payload, delivery_tag=delivery_tag)
        return cls(
            consumer=resolved_consumer,
            repository=resolved_repository,
            cancellation=cancellation or InMemoryCancellationChecker(),
            analyze=analyze or AnalyzeStub(),
            temp_root=temp_root,
            fast_path_enabled=fast_path_enabled,
            debug_dir_base=debug_dir_base,
        )

    def enqueue(self, payload: dict[str, str], *, delivery_tag: str = "d1") -> None:
        self.consumer.enqueue(payload, delivery_tag=delivery_tag)

    def seed(
        self,
        payload: dict[str, str] | None = None,
        *,
        status: OcrJobStatus = OcrJobStatus.QUEUED,
        worker_id: str | None = None,
    ) -> OcrJobRecord:
        return seed_job_record(
            self.repository,
            payload,
            status=status,
            worker_id=worker_id,
        )

    def deps(self) -> JobRunnerDependencies:
        return make_runner_dependencies(
            consumer=self.consumer,
            repository=self.repository,
            cancellation=self.cancellation,
            analyze=self.analyze,
            temp_root=self.temp_root,
            fast_path_enabled=self.fast_path_enabled,
            debug_dir_base=self.debug_dir_base,
        )

    def run(self) -> JobRunOutcome:
        return run_one_job(self.deps())

    def record(self, job_id: str = "job-1") -> OcrJobRecord:
        return self.repository.records[job_id]
