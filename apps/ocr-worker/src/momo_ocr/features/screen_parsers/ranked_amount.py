from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from momo_ocr.features.image_processing.geometry import Rect, Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import OcrWarning, WarningCode
from momo_ocr.features.parser_core.context import ScreenParseContext
from momo_ocr.features.parser_core.debug import DebugSink
from momo_ocr.features.player_identity.aliases import (
    extract_player_identity,
)
from momo_ocr.features.result_projection.models import (
    RankedAmountFieldName,
    RankedAmountParseResult,
    RankedAmountParserName,
    RankedAmountRowResult,
)
from momo_ocr.features.screen_parsers.ranked_row_ocr import (
    prepare_ranked_row_image,
    recognize_ranked_row_text,
)
from momo_ocr.features.temp_images.validation import open_decoded_image


class RankedRowProfile(Protocol):
    @property
    def rank(self) -> int:
        raise NotImplementedError

    @property
    def row_roi(self) -> Rect:
        raise NotImplementedError


class RankedAmountRowFactory(Protocol):
    def __call__(
        self,
        *,
        rank: int | None,
        raw_player_name: str | None,
        amount_man_yen: int | None,
        confidence: float | None,
        warnings: list[str],
    ) -> object:
        raise NotImplementedError


@dataclass(frozen=True)
class RankedAmountScreenSpec:
    parser_name: RankedAmountParserName
    row_profiles: Sequence[RankedRowProfile]
    row_factory: RankedAmountRowFactory
    parse_amount: Callable[[str], int | None]
    amount_field: RankedAmountFieldName
    amount_warning_message: Callable[[int], str]
    warn_duplicate_members: bool = False


def extract_ranked_amount_screen(
    *,
    context: ScreenParseContext,
    spec: RankedAmountScreenSpec,
) -> RankedAmountParseResult:
    image = context.parse_input.image
    owns_image = image is None
    if image is None:
        image = open_decoded_image(context.parse_input.image_path)
    try:
        return _extract_from_image(context=context, spec=spec, image=image)
    finally:
        if owns_image:
            image.close()


def _extract_from_image(
    *,
    context: ScreenParseContext,
    spec: RankedAmountScreenSpec,
    image: Image.Image,
) -> RankedAmountParseResult:
    image_size = Size(width=image.width, height=image.height)
    rows: list[RankedAmountRowResult] = []
    warnings: list[OcrWarning] = []
    raw_snippets: dict[str, str] = {}
    debug_sink = context.diagnostics.debug_sink.child(spec.parser_name)

    for row_profile in spec.row_profiles:
        row = _extract_row(
            context=context,
            spec=spec,
            image=image,
            image_size=image_size,
            row_profile=row_profile,
            debug_sink=debug_sink,
        )
        rows.append(row)
        warnings.extend(row.warnings)
        raw_snippets[f"rank_{row_profile.rank}"] = row.raw_text

    return RankedAmountParseResult(
        parser_name=spec.parser_name,
        amount_field=spec.amount_field,
        rows=tuple(rows),
        warnings=tuple(warnings),
        raw_snippets=raw_snippets,
        warn_duplicate_members=spec.warn_duplicate_members,
    )


def _extract_row(
    *,
    context: ScreenParseContext,
    spec: RankedAmountScreenSpec,
    image: Image.Image,
    image_size: Size,
    row_profile: RankedRowProfile,
    debug_sink: DebugSink,
) -> RankedAmountRowResult:
    row_image = crop_roi(
        image,
        scale_profile_rect_to_image(row_profile.row_roi, image_size),
    )
    prepared_row = prepare_ranked_row_image(row_image)
    _save_debug_ranked_row(
        row_image=row_image,
        prepared_row=prepared_row,
        debug_sink=debug_sink,
        rank=row_profile.rank,
    )
    recognized_row = recognize_ranked_row_text(
        row_image,
        text_engine=context.services.text_engine,
        fallback_image=row_image,
    )
    player_identity = extract_player_identity(
        recognized_row.text,
        alias_resolver=context.services.alias_resolver,
    )
    amount_man_yen = spec.parse_amount(recognized_row.text)
    row_warnings = _row_warnings(
        rank=row_profile.rank,
        raw_player_name=player_identity.raw_player_name,
        amount_man_yen=amount_man_yen,
        amount_field=spec.amount_field,
        amount_warning_message=spec.amount_warning_message,
    )
    return RankedAmountRowResult(
        rank=row_profile.rank,
        player_identity=player_identity,
        amount_man_yen=amount_man_yen,
        confidence=recognized_row.confidence,
        raw_text=recognized_row.text,
        warnings=tuple(row_warnings),
        payload_row=spec.row_factory(
            rank=row_profile.rank,
            raw_player_name=player_identity.raw_player_name,
            amount_man_yen=amount_man_yen,
            confidence=recognized_row.confidence,
            warnings=[warning.code.value for warning in row_warnings],
        ),
    )


def _save_debug_ranked_row(
    *,
    row_image: Image.Image,
    prepared_row: Image.Image,
    debug_sink: DebugSink,
    rank: int,
) -> None:
    debug_sink.save_image(f"rank_{rank}_row.png", row_image)
    debug_sink.save_image(f"rank_{rank}_row_prepared.png", prepared_row)


def _row_warnings(
    *,
    rank: int,
    raw_player_name: str | None,
    amount_man_yen: int | None,
    amount_field: RankedAmountFieldName,
    amount_warning_message: Callable[[int], str],
) -> list[OcrWarning]:
    warnings: list[OcrWarning] = []
    if raw_player_name is None:
        warnings.append(
            OcrWarning(
                code=WarningCode.UNKNOWN_PLAYER_ALIAS,
                message=f"Could not read player name for rank {rank}.",
                field_path=f"players[{rank - 1}].raw_player_name",
            )
        )
    if amount_man_yen is None:
        warnings.append(
            OcrWarning(
                code=WarningCode.MISSING_AMOUNT,
                message=amount_warning_message(rank),
                field_path=f"players[{rank - 1}].{amount_field}",
            )
        )
    return warnings
