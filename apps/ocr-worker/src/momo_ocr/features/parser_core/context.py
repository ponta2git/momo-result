from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_domain.models import OcrWarning, ScreenType
from momo_ocr.features.parser_core.debug import NULL_DEBUG_SINK, DebugSink
from momo_ocr.features.player_identity.aliases import DEFAULT_ALIAS_RESOLVER, PlayerAliasResolver
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine


@dataclass(frozen=True)
class ParseInput:
    image_path: Path
    requested_screen_type: ScreenType
    detected_screen_type: ScreenType
    profile_id: str
    image: Image.Image | None = None


@dataclass(frozen=True)
class RecognitionServices:
    text_engine: TextRecognitionEngine
    alias_resolver: PlayerAliasResolver = DEFAULT_ALIAS_RESOLVER


@dataclass(frozen=True)
class ParsePolicy:
    include_raw_text: bool
    fast_path_enabled: bool = False


@dataclass(frozen=True)
class ParseDiagnostics:
    debug_sink: DebugSink = NULL_DEBUG_SINK
    warnings: tuple[OcrWarning, ...] = ()


@dataclass(frozen=True)
class ScreenParseContext:
    parse_input: ParseInput
    services: RecognitionServices
    policy: ParsePolicy
    diagnostics: ParseDiagnostics
    player_order_detection: object | None = None
    layout_family_hint: str | None = None
