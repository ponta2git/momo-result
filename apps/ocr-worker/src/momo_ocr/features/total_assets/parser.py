from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.ocr_results.models import ImageType, OcrDraftPayload
from momo_ocr.features.ocr_results.parsing import ParseContext, pending_parser_payload


@dataclass(frozen=True)
class TotalAssetsParser:
    image_type: ImageType = ImageType.TOTAL_ASSETS

    def parse(self, context: ParseContext) -> OcrDraftPayload:
        return pending_parser_payload(context, parser_name="total_assets")
