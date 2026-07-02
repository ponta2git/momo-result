from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.parser_core.context import ScreenParseContext
from momo_ocr.features.result_projection.models import RankedAmountParseResult
from momo_ocr.features.screen_parsers.ranked_amount import (
    RankedAmountScreenSpec,
    extract_ranked_amount_screen,
)
from momo_ocr.features.total_assets.models import TotalAssetRow
from momo_ocr.features.total_assets.postprocess import parse_man_yen
from momo_ocr.features.total_assets.profile import ROW_PROFILES

_TOTAL_ASSETS_SPEC = RankedAmountScreenSpec(
    parser_name="total_assets",
    row_profiles=ROW_PROFILES,
    row_factory=TotalAssetRow,
    parse_amount=parse_man_yen,
    amount_field="total_assets_man_yen",
    amount_warning_message=lambda rank: f"Could not read total assets for rank {rank}.",
)


@dataclass(frozen=True)
class TotalAssetsParser:
    screen_type: ScreenType = ScreenType.TOTAL_ASSETS

    def parse(self, context: ScreenParseContext) -> RankedAmountParseResult:
        return extract_ranked_amount_screen(context=context, spec=_TOTAL_ASSETS_SPEC)
