"""Mapping from queue hints to a :class:`PlayerAliasResolver`.

Pulled out of ``runner`` so the orchestration module stays focused on
state transitions.
"""

from __future__ import annotations

from momo_ocr.features.ocr_jobs.models import OcrJobHints
from momo_ocr.features.ocr_results.ranked_rows import (
    DEFAULT_STATIC_ALIASES,
    PlayerAliasResolver,
    alias_resolver_from_map,
)


def alias_resolver_from_hints(hints: OcrJobHints) -> PlayerAliasResolver:
    aliases: dict[str, tuple[str, ...]] = {
        canonical: tuple(values) for canonical, values in DEFAULT_STATIC_ALIASES.items()
    }
    for hint in hints.known_player_aliases:
        existing = aliases.get(hint.member_id, ())
        aliases[hint.member_id] = _dedupe_preserve_order((*existing, *hint.aliases))
    if hints.computer_player_aliases:
        existing_cpu = aliases.get("さくま社長", ())
        aliases["さくま社長"] = _dedupe_preserve_order(
            (*existing_cpu, *hints.computer_player_aliases)
        )
    return alias_resolver_from_map(aliases)


def _dedupe_preserve_order(items: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return tuple(out)
