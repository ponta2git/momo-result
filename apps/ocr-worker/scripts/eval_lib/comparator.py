"""Per-screen-type field-level diff between predicted and expected player rows.

`compare_player` is split into screen-type specific helpers so each branch stays
small enough that ruff C901 / PLR0911 are satisfied without per-file-ignores.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from eval_lib.types import (
    INCIDENT_COLUMNS,
    REVENUE_COLUMNS,
    TOTAL_ASSETS_COLUMNS,
    ExpectedPlayer,
)
from momo_ocr.features.ocr_domain.models import PlayerResultDraft


@dataclass(slots=True)
class _Recorder:
    """Records (correct, total) and appends diffs for one expected/predicted pair."""

    expected: ExpectedPlayer
    diffs: list[dict[str, Any]]
    correct: int = 0
    total: int = 0

    def record(self, field_name: str, exp: object, got: object) -> None:
        self.total += 1
        if exp == got:
            self.correct += 1
            return
        self.diffs.append(
            {
                "play_order": self.expected.play_order,
                "field": field_name,
                "expected": exp,
                "got": got,
            }
        )


def _missing_player(
    expected: ExpectedPlayer,
    screen_type: str,
    diffs: list[dict[str, Any]],
) -> tuple[int, int]:
    diffs.append(
        {
            "play_order": expected.play_order,
            "field": "<player>",
            "expected": expected.name,
            "got": None,
        }
    )
    if screen_type == "total_assets":
        return 0, len(TOTAL_ASSETS_COLUMNS)
    if screen_type == "revenue":
        return 0, len(REVENUE_COLUMNS)
    if screen_type == "incident_log":
        return 0, len(INCIDENT_COLUMNS)
    return 0, 0


def _compare_total_assets(rec: _Recorder, predicted: PlayerResultDraft) -> None:
    rec.record("rank", rec.expected.rank, predicted.rank.value)
    rec.record(
        "total_assets",
        rec.expected.total_assets,
        predicted.total_assets_man_yen.value,
    )


def _compare_revenue(rec: _Recorder, predicted: PlayerResultDraft) -> None:
    rec.record("revenue", rec.expected.revenue, predicted.revenue_man_yen.value)


def _compare_incident_log(rec: _Recorder, predicted: PlayerResultDraft) -> None:
    for col in INCIDENT_COLUMNS:
        got_field = predicted.incidents.get(col)
        got = got_field.value if got_field is not None else None
        rec.record(col, rec.expected.incidents.get(col), got)


_PER_SCREEN_COMPARATORS: dict[str, Callable[[_Recorder, PlayerResultDraft], None]] = {
    "total_assets": _compare_total_assets,
    "revenue": _compare_revenue,
    "incident_log": _compare_incident_log,
}


def compare_player(
    *,
    expected: ExpectedPlayer,
    predicted: PlayerResultDraft | None,
    screen_type: str,
    diffs: list[dict[str, Any]],
) -> tuple[int, int]:
    """Return (correct, total) for the predicted vs expected pair."""
    if predicted is None:
        return _missing_player(expected, screen_type, diffs)
    rec = _Recorder(expected=expected, diffs=diffs)
    comparator = _PER_SCREEN_COMPARATORS.get(screen_type)
    if comparator is not None:
        comparator(rec, predicted)
    return rec.correct, rec.total
