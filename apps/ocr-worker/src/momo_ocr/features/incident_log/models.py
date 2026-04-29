from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IncidentLogRow:
    raw_player_name: str | None
    counts: dict[str, int | None]
    confidence: float | None
    warnings: list[str]
