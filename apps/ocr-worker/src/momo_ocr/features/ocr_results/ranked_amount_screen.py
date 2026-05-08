from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from momo_ocr.features.image_processing.geometry import Rect, Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    WarningCode,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.ocr_results.player_aliases import (
    ExtractedPlayerIdentity,
    extract_player_identity,
)
from momo_ocr.features.ocr_results.ranked_row_debug import save_debug_ranked_row
from momo_ocr.features.ocr_results.ranked_row_ocr import (
    prepare_ranked_row_image,
    recognize_ranked_row_text,
)
from momo_ocr.features.player_order.detector import apply_player_order_to_ranked_players
from momo_ocr.features.temp_images.validation import open_decoded_image

AmountFieldName = Literal["total_assets_man_yen", "revenue_man_yen"]


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
    parser_name: str
    row_profiles: Sequence[RankedRowProfile]
    row_factory: RankedAmountRowFactory
    parse_amount: Callable[[str], int | None]
    amount_field: AmountFieldName
    amount_warning_message: Callable[[int], str]


def parse_ranked_amount_screen(
    *,
    context: ScreenParseContext,
    spec: RankedAmountScreenSpec,
) -> OcrDraftPayload:
    image = context.image if context.image is not None else open_decoded_image(context.image_path)
    image_size = Size(width=image.width, height=image.height)
    rows: list[object] = []
    players: list[PlayerResultDraft] = []
    warnings = list(context.warnings)
    raw_snippets: dict[str, str] = {}

    debug_dir = context.debug_dir / spec.parser_name if context.debug_dir is not None else None
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)

    for row_profile in spec.row_profiles:
        row_image = crop_roi(
            image,
            scale_profile_rect_to_image(row_profile.row_roi, image_size),
        )
        prepared_row = prepare_ranked_row_image(row_image)
        if debug_dir is not None:
            save_debug_ranked_row(
                row_image=row_image,
                prepared_row=prepared_row,
                debug_dir=debug_dir,
                rank=row_profile.rank,
            )

        recognized_row = recognize_ranked_row_text(
            row_image,
            text_engine=context.text_engine,
            fallback_image=row_image,
        )
        player_identity = extract_player_identity(
            recognized_row.text,
            alias_resolver=context.alias_resolver,
        )
        amount_man_yen = spec.parse_amount(recognized_row.text)
        row_warnings = _row_warnings(
            rank=row_profile.rank,
            raw_player_name=player_identity.raw_player_name,
            amount_man_yen=amount_man_yen,
            amount_field=spec.amount_field,
            amount_warning_message=spec.amount_warning_message,
        )
        warnings.extend(row_warnings)
        raw_snippets[f"rank_{row_profile.rank}"] = recognized_row.text

        rows.append(
            spec.row_factory(
                rank=row_profile.rank,
                raw_player_name=player_identity.raw_player_name,
                amount_man_yen=amount_man_yen,
                confidence=recognized_row.confidence,
                warnings=[warning.code.value for warning in row_warnings],
            )
        )
        players.append(
            _ranked_amount_player(
                rank=row_profile.rank,
                player_identity=player_identity,
                amount_man_yen=amount_man_yen,
                amount_field=spec.amount_field,
                raw_text=recognized_row.text,
                confidence=recognized_row.confidence,
            )
        )

    players = apply_player_order_to_ranked_players(players, context.player_order_detection)
    return OcrDraftPayload(
        requested_screen_type=context.requested_screen_type,
        detected_screen_type=context.detected_screen_type,
        profile_id=context.profile_id,
        players=players,
        category_payload={
            "status": "parsed",
            "parser": spec.parser_name,
            "rows": rows,
            "player_order": context.player_order_detection,
            "include_raw_text": context.include_raw_text,
        },
        warnings=warnings,
        raw_snippets=raw_snippets if context.include_raw_text else None,
    )


def _row_warnings(
    *,
    rank: int,
    raw_player_name: str | None,
    amount_man_yen: int | None,
    amount_field: AmountFieldName,
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


def _ranked_amount_player(
    *,
    rank: int,
    player_identity: ExtractedPlayerIdentity,
    amount_man_yen: int | None,
    amount_field: AmountFieldName,
    raw_text: str,
    confidence: float | None,
) -> PlayerResultDraft:
    amount = OcrField(value=amount_man_yen, raw_text=raw_text, confidence=confidence)
    raw_player_name = OcrField(
        value=player_identity.raw_player_name,
        raw_text=raw_text,
        confidence=confidence,
    )
    rank_field = OcrField(value=rank, raw_text=str(rank), confidence=1.0)
    if amount_field == "total_assets_man_yen":
        return PlayerResultDraft(
            raw_player_name=raw_player_name,
            member_id=player_identity.member_id,
            rank=rank_field,
            total_assets_man_yen=amount,
        )
    return PlayerResultDraft(
        raw_player_name=raw_player_name,
        member_id=player_identity.member_id,
        rank=rank_field,
        revenue_man_yen=amount,
    )
