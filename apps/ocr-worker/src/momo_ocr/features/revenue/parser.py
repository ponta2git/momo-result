from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.ocr_results.ranked_rows import (
    PlayerAliasResolver,
    extract_player_name_candidate,
    prepare_ranked_row_image,
    recognize_ranked_row_text,
    save_debug_ranked_row,
)
from momo_ocr.features.player_order.detector import apply_player_order_to_ranked_players
from momo_ocr.features.revenue.models import RevenueRow
from momo_ocr.features.revenue.postprocess import parse_man_yen
from momo_ocr.features.revenue.profile import ROW_PROFILES
from momo_ocr.features.temp_images.validation import open_decoded_image


@dataclass(frozen=True)
class RevenueParser:
    screen_type: ScreenType = ScreenType.REVENUE

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = (
            context.image if context.image is not None else open_decoded_image(context.image_path)
        )
        image_size = Size(width=image.width, height=image.height)
        rows: list[RevenueRow] = []
        players: list[PlayerResultDraft] = []
        warnings = list(context.warnings)
        raw_snippets: dict[str, str] = {}

        debug_dir = context.debug_dir / "revenue" if context.debug_dir is not None else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        for row_profile in ROW_PROFILES:
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
            row_warnings = _row_warnings(
                rank=row_profile.rank,
                raw_text=recognized_row.text,
                alias_resolver=context.alias_resolver,
            )
            warnings.extend(row_warnings)
            raw_snippets[f"rank_{row_profile.rank}"] = recognized_row.text

            raw_player_name = extract_player_name_candidate(
                recognized_row.text, alias_resolver=context.alias_resolver
            )
            amount_man_yen = parse_man_yen(recognized_row.text)
            rows.append(
                RevenueRow(
                    rank=row_profile.rank,
                    raw_player_name=raw_player_name,
                    amount_man_yen=amount_man_yen,
                    confidence=recognized_row.confidence,
                    warnings=[warning.code.value for warning in row_warnings],
                )
            )
            players.append(
                PlayerResultDraft(
                    raw_player_name=OcrField(
                        value=raw_player_name,
                        raw_text=recognized_row.text,
                        confidence=recognized_row.confidence,
                    ),
                    rank=OcrField(
                        value=row_profile.rank,
                        raw_text=str(row_profile.rank),
                        confidence=1.0,
                    ),
                    revenue_man_yen=OcrField(
                        value=amount_man_yen,
                        raw_text=recognized_row.text,
                        confidence=recognized_row.confidence,
                    ),
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
                "parser": "revenue",
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
    raw_text: str,
    alias_resolver: PlayerAliasResolver,
) -> list[OcrWarning]:
    warnings: list[OcrWarning] = []
    if extract_player_name_candidate(raw_text, alias_resolver=alias_resolver) is None:
        warnings.append(
            OcrWarning(
                code=WarningCode.UNKNOWN_PLAYER_ALIAS,
                message=f"Could not read player name for revenue rank {rank}.",
                field_path=f"players[{rank - 1}].raw_player_name",
            )
        )
    if parse_man_yen(raw_text) is None:
        warnings.append(
            OcrWarning(
                code=WarningCode.MISSING_AMOUNT,
                message=f"Could not read revenue for rank {rank}.",
                field_path=f"players[{rank - 1}].revenue_man_yen",
            )
        )
    return warnings
