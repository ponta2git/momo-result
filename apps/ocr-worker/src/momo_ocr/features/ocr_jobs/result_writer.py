from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Protocol

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning


@dataclass(frozen=True)
class OcrResultRecord:
    job_id: str
    draft_id: str
    payload: OcrDraftPayload
    warnings: tuple[OcrWarning, ...]
    timings_ms: dict[str, float]


class OcrResultWriter(Protocol):
    """Persists a successful OCR draft for a given job.

    The writer is invoked exactly once per job before the queue is acked. It
    must be idempotent on ``job_id``: a successful retry of the same job (e.g.
    after a worker crash before ack) must not produce duplicate drafts.
    """

    def persist(self, record: OcrResultRecord) -> None:
        raise NotImplementedError


@dataclass
class InMemoryOcrResultWriter:
    """Test double implementing :class:`OcrResultWriter`.

    Records writes keyed by ``job_id`` so tests can assert that each job
    persists at most one draft, regardless of redeliveries.
    """

    records: dict[str, OcrResultRecord] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)

    def persist(self, record: OcrResultRecord) -> None:
        with self._lock:
            self.records[record.job_id] = record
