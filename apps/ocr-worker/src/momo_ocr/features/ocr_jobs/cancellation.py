from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Protocol

from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository


class CancellationChecker(Protocol):
    """Checks whether a job has been cancelled by the API/orchestrator.

    Implementations consult the source-of-truth DB, which the API mutates
    when a user cancels an in-flight OCR job. The runner polls between
    pipeline phases and aborts cleanly when a cancellation is observed.
    """

    def is_cancelled(self, job_id: str) -> bool:
        raise NotImplementedError


@dataclass(frozen=True)
class RepositoryCancellationChecker:
    """Cancellation source backed by an :class:`OcrJobRepository`."""

    repository: OcrJobRepository

    def is_cancelled(self, job_id: str) -> bool:
        status = self.repository.get_status(job_id)
        return status is OcrJobStatus.CANCELLED


@dataclass
class InMemoryCancellationChecker:
    """Test double implementing :class:`CancellationChecker`."""

    cancelled_job_ids: set[str] = field(default_factory=set)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def cancel(self, job_id: str) -> None:
        with self._lock:
            self.cancelled_job_ids.add(job_id)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self.cancelled_job_ids


def should_cancel() -> bool:
    """Compatibility shim retained for legacy callers; always returns False."""
    return False
