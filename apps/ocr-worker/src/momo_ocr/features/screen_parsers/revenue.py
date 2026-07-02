from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.parser_core.context import ScreenParseContext
from momo_ocr.features.result_projection.models import RankedAmountParseResult
from momo_ocr.features.revenue.models import RevenueRow
from momo_ocr.features.revenue.postprocess import parse_man_yen
from momo_ocr.features.revenue.profile import ROW_PROFILES
from momo_ocr.features.screen_parsers.ranked_amount import (
    RankedAmountScreenSpec,
    extract_ranked_amount_screen,
)

_REVENUE_SPEC = RankedAmountScreenSpec(
    parser_name="revenue",
    row_profiles=ROW_PROFILES,
    row_factory=RevenueRow,
    parse_amount=parse_man_yen,
    amount_field="revenue_man_yen",
    amount_warning_message=lambda rank: f"Could not read revenue for rank {rank}.",
    warn_duplicate_members=True,
)


@dataclass(frozen=True)
class RevenueParser:
    screen_type: ScreenType = ScreenType.REVENUE

    def parse(self, context: ScreenParseContext) -> RankedAmountParseResult:
        return extract_ranked_amount_screen(context=context, spec=_REVENUE_SPEC)
