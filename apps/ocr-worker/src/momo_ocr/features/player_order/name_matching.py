from __future__ import annotations

import re
from difflib import SequenceMatcher

from momo_ocr.features.player_order.models import PlayerOrderSlot

MIN_NAME_MATCH_LENGTH = 3
MIN_NAME_SIMILARITY = 0.65
NAME_CONFUSION_REPLACEMENTS = (
    ("いローゆ", "いーゆ"),
    ("いハーゆ", "いーゆ"),
    ("ローゆ", "いーゆ"),
    ("ハーゆ", "いーゆ"),
    ("バーゆ", "いーゆ"),
    ("コーツ力", "オータカ"),
)


def find_matching_slot(
    player_name: str,
    slots: list[PlayerOrderSlot],
) -> PlayerOrderSlot | None:
    normalized_player = normalize_name_for_match(player_name)
    if len(normalized_player) < MIN_NAME_MATCH_LENGTH:
        return None
    for slot in slots:
        if slot.raw_player_name is not None and _names_match(normalized_player, slot):
            return slot
    return None


def normalize_name_for_match(name: str) -> str:
    normalized = name.replace("一", "ー").replace("_", "ー")
    for source, replacement in NAME_CONFUSION_REPLACEMENTS:
        normalized = normalized.replace(source, replacement)
    return re.sub(r"[^A-Za-z0-9一-龥ぁ-んァ-ンー]", "", normalized)


def _names_match(normalized_player: str, slot: PlayerOrderSlot) -> bool:
    if slot.raw_player_name is None:
        return False
    normalized_slot = normalize_name_for_match(slot.raw_player_name)
    return (
        normalized_player in normalized_slot
        or normalized_slot in normalized_player
        or strip_president_suffix(normalized_player) in normalized_slot
        or remove_long_vowel_marks(strip_president_suffix(normalized_player))
        in remove_long_vowel_marks(normalized_slot)
        or name_similarity(normalized_player, normalized_slot) >= MIN_NAME_SIMILARITY
    )


def strip_president_suffix(name: str) -> str:
    return name.removesuffix("社長")


def remove_long_vowel_marks(name: str) -> str:
    return name.replace("ー", "")


def name_similarity(left: str, right: str) -> float:
    left_core = remove_long_vowel_marks(strip_president_suffix(left))
    right_core = remove_long_vowel_marks(strip_president_suffix(right))
    if len(left_core) < MIN_NAME_MATCH_LENGTH or len(right_core) < MIN_NAME_MATCH_LENGTH:
        return 0.0
    return SequenceMatcher(a=left_core, b=right_core).ratio()
