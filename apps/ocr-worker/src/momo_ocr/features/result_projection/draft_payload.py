from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    WarningCode,
)
from momo_ocr.features.parser_core.context import ScreenParseContext
from momo_ocr.features.player_order.models import PlayerOrderDetection
from momo_ocr.features.result_projection.models import (
    IncidentLogParseResult,
    RankedAmountFieldName,
    RankedAmountParseResult,
    RankedAmountRowResult,
)
from momo_ocr.features.result_projection.player_order import (
    apply_player_order_to_column_players,
    apply_player_order_to_ranked_players,
)


@dataclass(frozen=True)
class RankedAmountCategoryPayload:
    status: str
    parser: str
    rows: tuple[object, ...]
    player_order: object
    include_raw_text: bool


@dataclass(frozen=True)
class IncidentLogCategoryPayload:
    status: str
    parser: str
    layout_profile_id: str
    incident_names: tuple[str, ...]
    rows: tuple[object, ...]
    player_order: object
    include_raw_text: bool


def project_parse_result(
    context: ScreenParseContext,
    parse_result: object,
) -> OcrDraftPayload:
    if isinstance(parse_result, RankedAmountParseResult):
        return _project_ranked_amount(context, parse_result)
    if isinstance(parse_result, IncidentLogParseResult):
        return _project_incident_log(context, parse_result)
    msg = f"Unsupported OCR parse result type: {type(parse_result).__name__}"
    raise TypeError(msg)


def _project_ranked_amount(
    context: ScreenParseContext,
    parse_result: RankedAmountParseResult,
) -> OcrDraftPayload:
    warnings = [*context.diagnostics.warnings, *parse_result.warnings]
    player_order_detection = _player_order_detection(context)
    players = [
        _ranked_amount_player(row, amount_field=parse_result.amount_field)
        for row in parse_result.rows
    ]
    players = apply_player_order_to_ranked_players(players, player_order_detection)
    if parse_result.warn_duplicate_members:
        warnings.extend(_duplicate_member_warnings(players, parser_name=parse_result.parser_name))
    category_payload = RankedAmountCategoryPayload(
        status="parsed",
        parser=parse_result.parser_name,
        rows=tuple(row.payload_row for row in parse_result.rows),
        player_order=player_order_detection,
        include_raw_text=context.policy.include_raw_text,
    )
    return OcrDraftPayload(
        requested_screen_type=context.parse_input.requested_screen_type,
        detected_screen_type=context.parse_input.detected_screen_type,
        profile_id=context.parse_input.profile_id,
        players=players,
        category_payload=_category_dict(category_payload),
        warnings=warnings,
        raw_snippets=parse_result.raw_snippets if context.policy.include_raw_text else None,
    )


def _project_incident_log(
    context: ScreenParseContext,
    parse_result: IncidentLogParseResult,
) -> OcrDraftPayload:
    warnings = [*context.diagnostics.warnings, *parse_result.warnings]
    player_order_detection = _player_order_detection(context)
    players = [PlayerResultDraft(incidents=counts) for counts in parse_result.player_counts]
    players = apply_player_order_to_column_players(players, player_order_detection)
    category_payload = IncidentLogCategoryPayload(
        status="parsed",
        parser="incident_log",
        layout_profile_id=parse_result.layout_profile_id,
        incident_names=parse_result.incident_names,
        rows=parse_result.rows,
        player_order=player_order_detection,
        include_raw_text=context.policy.include_raw_text,
    )
    return OcrDraftPayload(
        requested_screen_type=context.parse_input.requested_screen_type,
        detected_screen_type=context.parse_input.detected_screen_type,
        profile_id=context.parse_input.profile_id,
        players=players,
        category_payload=_category_dict(category_payload),
        warnings=warnings,
        raw_snippets=parse_result.raw_snippets if context.policy.include_raw_text else None,
    )


def _ranked_amount_player(
    row: RankedAmountRowResult,
    *,
    amount_field: RankedAmountFieldName,
) -> PlayerResultDraft:
    amount = OcrField(
        value=row.amount_man_yen,
        raw_text=row.raw_text,
        confidence=row.confidence,
    )
    raw_player_name = OcrField(
        value=row.player_identity.raw_player_name,
        raw_text=row.raw_text,
        confidence=row.confidence,
    )
    rank_field = OcrField(value=row.rank, raw_text=str(row.rank), confidence=1.0)
    if amount_field == "total_assets_man_yen":
        return PlayerResultDraft(
            raw_player_name=raw_player_name,
            member_id=row.player_identity.member_id,
            rank=rank_field,
            total_assets_man_yen=amount,
        )
    return PlayerResultDraft(
        raw_player_name=raw_player_name,
        member_id=row.player_identity.member_id,
        rank=rank_field,
        revenue_man_yen=amount,
    )


def _duplicate_member_warnings(
    players: list[PlayerResultDraft],
    *,
    parser_name: str,
) -> list[OcrWarning]:
    warnings: list[OcrWarning] = []
    first_index_by_member: dict[str, int] = {}
    for index, player in enumerate(players):
        if player.member_id is None:
            continue
        previous_index = first_index_by_member.get(player.member_id)
        if previous_index is None:
            first_index_by_member[player.member_id] = index
            continue
        warnings.append(
            OcrWarning(
                code=WarningCode.DUPLICATE_MEMBER_ALIAS,
                message=(
                    f"Multiple {parser_name} OCR rows resolved to the same member; "
                    f"first row index {previous_index} will be used for review."
                ),
                field_path=f"players[{index}].member_id",
            )
        )
    return warnings


def _category_dict(payload: object) -> dict[str, Any]:
    if isinstance(payload, RankedAmountCategoryPayload | IncidentLogCategoryPayload):
        return dict(asdict(payload))
    msg = f"Unsupported category payload type: {type(payload).__name__}"
    raise TypeError(msg)


def _player_order_detection(context: ScreenParseContext) -> PlayerOrderDetection | None:
    detection = context.player_order_detection
    if isinstance(detection, PlayerOrderDetection):
        return detection
    return None
