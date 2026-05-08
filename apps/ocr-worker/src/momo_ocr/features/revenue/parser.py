from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.ocr_results.ranked_amount_screen import (
    RankedAmountScreenSpec,
    parse_ranked_amount_screen,
)
from momo_ocr.features.revenue.models import RevenueRow
from momo_ocr.features.revenue.postprocess import parse_man_yen
from momo_ocr.features.revenue.profile import ROW_PROFILES

_REVENUE_SPEC = RankedAmountScreenSpec(
    parser_name="revenue",
    row_profiles=ROW_PROFILES,
    row_factory=RevenueRow,
    parse_amount=parse_man_yen,
    amount_field="revenue_man_yen",
    amount_warning_message=lambda rank: f"Could not read revenue for rank {rank}.",
)


@dataclass(frozen=True)
class RevenueParser:
    screen_type: ScreenType = ScreenType.REVENUE

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        return parse_ranked_amount_screen(context=context, spec=_REVENUE_SPEC)
