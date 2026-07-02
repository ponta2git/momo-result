from __future__ import annotations

from dataclasses import replace

from momo_ocr.features.ocr_domain.models import OcrField, PlayerResultDraft
from momo_ocr.features.player_order.models import PlayerOrderDetection, PlayerOrderSlot
from momo_ocr.features.player_order.name_matching import find_matching_slot


def apply_player_order_to_ranked_players(
    players: list[PlayerResultDraft],
    detection: PlayerOrderDetection | None,
) -> list[PlayerResultDraft]:
    if detection is None:
        return players
    return [_apply_order_by_name(player, detection) for player in players]


def apply_player_order_to_column_players(
    players: list[PlayerResultDraft],
    detection: PlayerOrderDetection | None,
) -> list[PlayerResultDraft]:
    if detection is None:
        return players
    return [
        _apply_column_slot(player, detection.slots[index] if index < len(detection.slots) else None)
        for index, player in enumerate(players)
    ]


def _apply_column_slot(
    player: PlayerResultDraft,
    slot: PlayerOrderSlot | None,
) -> PlayerResultDraft:
    if slot is None:
        return player
    raw_player_name = player.raw_player_name
    if raw_player_name.value is None and slot.raw_player_name is not None:
        raw_player_name = OcrField(
            value=slot.raw_player_name,
            raw_text=slot.raw_player_name,
            confidence=slot.name_confidence,
        )
    return replace(
        player,
        raw_player_name=raw_player_name,
        play_order=OcrField(
            value=slot.play_order,
            raw_text=slot.expected_color.value,
            confidence=slot.color_confidence,
        ),
    )


def _apply_order_by_name(
    player: PlayerResultDraft,
    detection: PlayerOrderDetection,
) -> PlayerResultDraft:
    player_name = player.raw_player_name.value
    if player_name is None:
        return player
    matched_slot = find_matching_slot(player_name, detection.slots)
    if matched_slot is None:
        return player
    return replace(
        player,
        play_order=OcrField(
            value=matched_slot.play_order,
            raw_text=matched_slot.raw_player_name,
            confidence=matched_slot.color_confidence,
        ),
    )
