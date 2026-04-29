from __future__ import annotations

from momo_ocr.features.incident_log.parser import IncidentLogParser
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ParserRegistry
from momo_ocr.features.revenue.parser import RevenueParser
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.total_assets.parser import TotalAssetsParser


def default_parser_registry() -> ParserRegistry:
    return ParserRegistry(
        parsers={
            ScreenType.TOTAL_ASSETS: TotalAssetsParser(),
            ScreenType.REVENUE: RevenueParser(),
            ScreenType.INCIDENT_LOG: IncidentLogParser(),
        }
    )


def default_text_recognition_engine() -> TextRecognitionEngine:
    return TesseractEngine()
