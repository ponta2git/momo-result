from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning, ScreenType
from momo_ocr.shared.errors import OcrFailure


class OcrJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class PlayerAliasHint:
    member_id: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class OcrJobHints:
    game_title: str | None = None
    layout_family: str | None = None
    known_player_aliases: tuple[PlayerAliasHint, ...] = ()
    computer_player_aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class OcrJobMessage:
    job_id: str
    draft_id: str
    image_id: str
    image_path: Path
    requested_screen_type: ScreenType
    attempt: int
    enqueued_at: str
    hints: OcrJobHints


@dataclass(frozen=True)
class OcrJobRecord:
    job_id: str
    draft_id: str
    image_id: str
    image_path: Path
    requested_screen_type: ScreenType
    detected_screen_type: ScreenType | None
    status: OcrJobStatus
    attempt_count: int
    worker_id: str | None
    failure: OcrFailure | None


@dataclass(frozen=True)
class OcrJobExecutionResult:
    status: OcrJobStatus
    draft_payload: OcrDraftPayload | None
    failure: OcrFailure | None
    warnings: list[OcrWarning]
    duration_ms: float
