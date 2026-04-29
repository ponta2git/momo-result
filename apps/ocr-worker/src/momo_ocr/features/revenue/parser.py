from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext, not_calibrated_payload


@dataclass(frozen=True)
class RevenueParser:
    screen_type: ScreenType = ScreenType.REVENUE

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        return not_calibrated_payload(context, parser_name="revenue")
