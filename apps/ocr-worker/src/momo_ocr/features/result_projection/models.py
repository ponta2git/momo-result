from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.ocr_domain.models import OcrField, OcrWarning
from momo_ocr.features.player_identity.aliases import ExtractedPlayerIdentity

RankedAmountParserName = Literal["total_assets", "revenue"]
RankedAmountFieldName = Literal["total_assets_man_yen", "revenue_man_yen"]


@dataclass(frozen=True)
class RankedAmountRowResult:
    rank: int
    player_identity: ExtractedPlayerIdentity
    amount_man_yen: int | None
    confidence: float | None
    raw_text: str
    warnings: tuple[OcrWarning, ...]
    payload_row: object


@dataclass(frozen=True)
class RankedAmountParseResult:
    parser_name: RankedAmountParserName
    amount_field: RankedAmountFieldName
    rows: tuple[RankedAmountRowResult, ...]
    warnings: tuple[OcrWarning, ...]
    raw_snippets: dict[str, str]
    warn_duplicate_members: bool = False


@dataclass(frozen=True)
class IncidentLogParseResult:
    layout_profile_id: str
    incident_names: tuple[str, ...]
    player_counts: tuple[dict[str, OcrField[int]], ...]
    rows: tuple[IncidentLogRow, ...]
    warnings: tuple[OcrWarning, ...]
    raw_snippets: dict[str, str]


ScreenParseResult = RankedAmountParseResult | IncidentLogParseResult
