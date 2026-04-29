from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrWarning,
    ScreenType,
    WarningCode,
    WarningSeverity,
)


@dataclass(frozen=True)
class ScreenParseContext:
    image_path: Path
    requested_screen_type: ScreenType
    detected_screen_type: ScreenType
    profile_id: str
    debug_dir: Path | None
    include_raw_text: bool
    warnings: list[OcrWarning] = field(default_factory=list)


class ScreenParser(Protocol):
    @property
    def screen_type(self) -> ScreenType:
        raise NotImplementedError

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        raise NotImplementedError


@dataclass(frozen=True)
class ParserRegistry:
    parsers: dict[ScreenType, ScreenParser]

    def get(self, screen_type: ScreenType) -> ScreenParser:
        return self.parsers[screen_type]


def not_calibrated_payload(context: ScreenParseContext, *, parser_name: str) -> OcrDraftPayload:
    parser_warning = OcrWarning(
        code=WarningCode.PARSER_NOT_IMPLEMENTED,
        message=f"{parser_name} is wired but not calibrated yet.",
        severity=WarningSeverity.INFO,
    )
    return OcrDraftPayload(
        requested_screen_type=context.requested_screen_type,
        detected_screen_type=context.detected_screen_type,
        profile_id=context.profile_id,
        category_payload={
            "status": "pending_parser",
            "parser": parser_name,
            "include_raw_text": context.include_raw_text,
        },
        warnings=[*context.warnings, parser_warning],
    )
