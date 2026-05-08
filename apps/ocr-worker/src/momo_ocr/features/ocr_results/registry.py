from __future__ import annotations

from momo_ocr.features.incident_log.parser import IncidentLogParser
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ParserRegistry
from momo_ocr.features.revenue.parser import RevenueParser
from momo_ocr.features.total_assets.parser import TotalAssetsParser


def default_parser_registry() -> ParserRegistry:
    return ParserRegistry(
        parsers={
            ScreenType.TOTAL_ASSETS: TotalAssetsParser(),
            ScreenType.REVENUE: RevenueParser(),
            ScreenType.INCIDENT_LOG: IncidentLogParser(),
        }
    )
