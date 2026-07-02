from __future__ import annotations

from pathlib import Path
from typing import Protocol, cast

from PIL import Image

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning, ScreenType
from momo_ocr.features.parser_core.context import (
    ParseDiagnostics,
    ParseInput,
    ParsePolicy,
    RecognitionServices,
    ScreenParseContext,
)
from momo_ocr.features.parser_core.debug import debug_sink_from_dir
from momo_ocr.features.player_identity.aliases import DEFAULT_ALIAS_RESOLVER, PlayerAliasResolver
from momo_ocr.features.player_order.models import PlayerOrderDetection
from momo_ocr.features.result_projection.draft_payload import project_parse_result
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine


class _ParseCallable(Protocol):
    def parse(self, context: ScreenParseContext) -> object:
        raise NotImplementedError


def make_parse_context(  # noqa: PLR0913 - test factory mirrors parse context fields.
    *,
    image_path: Path,
    requested_screen_type: ScreenType,
    detected_screen_type: ScreenType,
    profile_id: str,
    debug_dir: Path | None,
    include_raw_text: bool,
    text_engine: TextRecognitionEngine,
    alias_resolver: PlayerAliasResolver = DEFAULT_ALIAS_RESOLVER,
    warnings: tuple[OcrWarning, ...] = (),
    image: Image.Image | None = None,
    layout_family_hint: str | None = None,
    player_order_detection: PlayerOrderDetection | None = None,
) -> ScreenParseContext:
    return ScreenParseContext(
        parse_input=ParseInput(
            image_path=image_path,
            requested_screen_type=requested_screen_type,
            detected_screen_type=detected_screen_type,
            profile_id=profile_id,
            image=image,
        ),
        services=RecognitionServices(
            text_engine=text_engine,
            alias_resolver=alias_resolver,
        ),
        policy=ParsePolicy(
            include_raw_text=include_raw_text,
        ),
        diagnostics=ParseDiagnostics(
            debug_sink=debug_sink_from_dir(debug_dir),
            warnings=warnings,
        ),
        player_order_detection=player_order_detection,
        layout_family_hint=layout_family_hint,
    )


def parse_payload(parser: object, context: ScreenParseContext) -> OcrDraftPayload:
    parse_result = cast("_ParseCallable", parser).parse(context)
    return project_parse_result(context, parse_result)
