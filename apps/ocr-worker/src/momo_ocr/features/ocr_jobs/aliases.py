"""Mapping from queue hints to a :class:`PlayerAliasResolver`.

Pulled out of ``runner`` so the orchestration module stays focused on
state transitions.
"""

from __future__ import annotations

from momo_ocr.features.ocr_jobs.models import OcrJobHints
from momo_ocr.features.ocr_results.player_aliases import (
    DEFAULT_STATIC_ALIASES,
    PlayerAliasResolver,
)


def alias_resolver_from_hints(hints: OcrJobHints) -> PlayerAliasResolver:
    pairs: list[tuple[str, str, str | None]] = [
        (canonical, surface, None)
        for canonical, surfaces in DEFAULT_STATIC_ALIASES.items()
        for surface in surfaces
    ]
    for hint in hints.known_player_aliases:
        display_name = _display_name_from_hint(hint.member_id, hint.aliases)
        pairs.extend((display_name, alias, hint.member_id) for alias in hint.aliases)
    if hints.computer_player_aliases:
        pairs.extend(("さくま社長", alias, None) for alias in hints.computer_player_aliases)
    return PlayerAliasResolver(pairs=tuple(_dedupe_pairs_preserve_order(tuple(pairs))))


def _dedupe_pairs_preserve_order(
    items: tuple[tuple[str, str, str | None], ...],
) -> tuple[tuple[str, str, str | None], ...]:
    seen: set[tuple[str, str, str | None]] = set()
    out: list[tuple[str, str, str | None]] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return tuple(out)


def _display_name_from_hint(member_id: str, aliases: tuple[str, ...]) -> str:
    for alias in aliases:
        if alias:
            return alias
    return member_id
