from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.parser_core.context import ScreenParseContext


class ScreenParser(Protocol):
    @property
    def screen_type(self) -> ScreenType:
        raise NotImplementedError

    def parse(self, context: ScreenParseContext) -> object:
        raise NotImplementedError


@dataclass(frozen=True)
class ParserRegistry:
    parsers: dict[ScreenType, ScreenParser]

    def get(self, screen_type: ScreenType) -> ScreenParser:
        return self.parsers[screen_type]
