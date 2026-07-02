from __future__ import annotations

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.parser_core.registry import ParserRegistry
from momo_ocr.features.screen_parsers.incident_log import IncidentLogParser
from momo_ocr.features.screen_parsers.revenue import RevenueParser
from momo_ocr.features.screen_parsers.total_assets import TotalAssetsParser


def default_parser_registry() -> ParserRegistry:
    return ParserRegistry(
        parsers={
            ScreenType.TOTAL_ASSETS: TotalAssetsParser(),
            ScreenType.REVENUE: RevenueParser(),
            ScreenType.INCIDENT_LOG: IncidentLogParser(),
        }
    )
