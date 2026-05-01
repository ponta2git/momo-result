"""Shared dataclasses and constants for the OCR accuracy evaluator."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SLOT_PREFIX_TO_TYPE: dict[str, str] = {
    "01": "total_assets",
    "02": "revenue",
    "03": "incident_log",
}

INCIDENT_COLUMNS: tuple[str, ...] = (
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
)

# Compare predicted vs expected only on screens where the value is present.
TOTAL_ASSETS_COLUMNS: tuple[str, ...] = ("rank", "total_assets")
REVENUE_COLUMNS: tuple[str, ...] = ("revenue",)


@dataclass
class FilenameMeta:
    path: Path
    game: str
    match_no: int
    date: str
    map_name: str
    slot_prefix: str
    slot_name: str
    screen_type: str

    @property
    def stem(self) -> str:
        return self.path.stem


@dataclass
class ExpectedPlayer:
    play_order: int
    name: str
    rank: int | None
    total_assets: int | None
    revenue: int | None
    incidents: dict[str, int]


@dataclass
class ImageEval:
    file: str
    match_no: int
    screen_type: str
    duration_ms_mean: float
    duration_ms_min: float
    duration_ms_max: float
    repeats: int
    failure: str | None
    detected_screen_type: str | None
    profile_id: str | None
    field_total: int = 0
    field_correct: int = 0
    diffs: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    debug_dir: str | None = None
