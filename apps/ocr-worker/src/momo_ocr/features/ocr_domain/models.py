from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class ScreenType(StrEnum):
    AUTO = "auto"
    TOTAL_ASSETS = "total_assets"
    REVENUE = "revenue"
    INCIDENT_LOG = "incident_log"


class WarningSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class WarningCode(StrEnum):
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    UNKNOWN_PLAYER_ALIAS = "UNKNOWN_PLAYER_ALIAS"
    MISSING_AMOUNT = "MISSING_AMOUNT"
    AMBIGUOUS_RANK = "AMBIGUOUS_RANK"
    CATEGORY_MISMATCH = "CATEGORY_MISMATCH"
    LAYOUT_ANCHOR_MISMATCH = "LAYOUT_ANCHOR_MISMATCH"
    SCREEN_TYPE_UNDETECTED = "SCREEN_TYPE_UNDETECTED"
    SCREEN_TYPE_DETECTION_FAILED = "SCREEN_TYPE_DETECTION_FAILED"
    DEBUG_OUTPUT_ENABLED = "DEBUG_OUTPUT_ENABLED"
    PARSER_NOT_IMPLEMENTED = "PARSER_NOT_IMPLEMENTED"
    MISSING_INCIDENT_COUNT = "MISSING_INCIDENT_COUNT"


@dataclass(frozen=True)
class OcrWarning:
    code: WarningCode
    message: str
    severity: WarningSeverity = WarningSeverity.WARNING
    field_path: str | None = None


@dataclass(frozen=True)
class OcrField[T]:
    value: T | None
    raw_text: str | None = None
    confidence: float | None = None
    warnings: list[OcrWarning] = field(default_factory=list)


@dataclass(frozen=True)
class PlayerResultDraft:
    raw_player_name: OcrField[str] = field(default_factory=lambda: OcrField[str](value=None))
    member_id: str | None = None
    play_order: OcrField[int] = field(default_factory=lambda: OcrField[int](value=None))
    rank: OcrField[int] = field(default_factory=lambda: OcrField[int](value=None))
    total_assets_man_yen: OcrField[int] = field(default_factory=lambda: OcrField[int](value=None))
    revenue_man_yen: OcrField[int] = field(default_factory=lambda: OcrField[int](value=None))
    incidents: dict[str, OcrField[int]] = field(default_factory=dict)


@dataclass(frozen=True)
class OcrDraftPayload:
    requested_screen_type: ScreenType
    detected_screen_type: ScreenType | None
    profile_id: str | None
    players: list[PlayerResultDraft] = field(default_factory=list)
    category_payload: dict[str, object] = field(default_factory=dict)
    warnings: list[OcrWarning] = field(default_factory=list)
    raw_snippets: dict[str, str] | None = None


@dataclass(frozen=True)
class StageTimings:
    timings_ms: dict[str, float] = field(default_factory=dict)
