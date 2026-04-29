from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TotalAssetRow:
    rank: int | None
    raw_player_name: str | None
    amount_man_yen: int | None
    confidence: float | None
    warnings: list[str]
