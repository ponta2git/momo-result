from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_results.models import (
    ImageType,
    OcrDraftPayload,
    OcrWarning,
    WarningCode,
    WarningSeverity,
)


@dataclass(frozen=True)
class ParseContext:
    image_path: Path
    requested_image_type: ImageType
    detected_image_type: ImageType
    profile_id: str
    debug_dir: Path | None
    include_raw_text: bool
    warnings: list[OcrWarning] = field(default_factory=list)


class ScreenParser(Protocol):
    @property
    def image_type(self) -> ImageType:
        raise NotImplementedError

    def parse(self, context: ParseContext) -> OcrDraftPayload:
        raise NotImplementedError


@dataclass(frozen=True)
class ParserRegistry:
    parsers: dict[ImageType, ScreenParser]

    def get(self, image_type: ImageType) -> ScreenParser:
        return self.parsers[image_type]


def pending_parser_payload(context: ParseContext, *, parser_name: str) -> OcrDraftPayload:
    parser_warning = OcrWarning(
        code=WarningCode.PARSER_NOT_IMPLEMENTED,
        message=f"{parser_name} is wired but not calibrated yet.",
        severity=WarningSeverity.INFO,
    )
    return OcrDraftPayload(
        requested_image_type=context.requested_image_type,
        detected_image_type=context.detected_image_type,
        profile_id=context.profile_id,
        category_payload={
            "status": "pending_parser",
            "parser": parser_name,
            "include_raw_text": context.include_raw_text,
        },
        warnings=[*context.warnings, parser_warning],
    )
