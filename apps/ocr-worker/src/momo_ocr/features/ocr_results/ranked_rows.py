from __future__ import annotations

from momo_ocr.features.ocr_results.player_aliases import (
    DEFAULT_ALIAS_RESOLVER,
    DEFAULT_STATIC_ALIASES,
    KNOWN_PLAYER_ALIASES,
    MIN_SAFE_ALIAS_LENGTH,
    ExtractedPlayerIdentity,
    PlayerAliasMatch,
    PlayerAliasResolver,
    _normalize_name_for_match,
    alias_resolver_from_map,
    alias_resolver_from_member_aliases,
    extract_player_identity,
    extract_player_name_candidate,
)
from momo_ocr.features.ocr_results.ranked_row_debug import save_debug_ranked_row
from momo_ocr.features.ocr_results.ranked_row_ocr import (
    ROW_OCR_PSMS,
    RankedRowOcrResult,
    prepare_ranked_row_image,
    prepare_ranked_row_image_variants,
    recognize_ranked_row_text,
)

__all__ = [
    "DEFAULT_ALIAS_RESOLVER",
    "DEFAULT_STATIC_ALIASES",
    "KNOWN_PLAYER_ALIASES",
    "MIN_SAFE_ALIAS_LENGTH",
    "ROW_OCR_PSMS",
    "ExtractedPlayerIdentity",
    "PlayerAliasMatch",
    "PlayerAliasResolver",
    "RankedRowOcrResult",
    "_normalize_name_for_match",
    "alias_resolver_from_map",
    "alias_resolver_from_member_aliases",
    "extract_player_identity",
    "extract_player_name_candidate",
    "prepare_ranked_row_image",
    "prepare_ranked_row_image_variants",
    "recognize_ranked_row_text",
    "save_debug_ranked_row",
]
