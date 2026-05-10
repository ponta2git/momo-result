from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from unicodedata import normalize

from momo_ocr.features.ocr_domain.money import MONEY_TEXT_RE
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

MIN_NOISE_PREFIX_TOKENS = 2
# Minimum normalized alias surface length. NFKC + lowercasing reduces
# display names like ``NO11社長`` to 5 characters. Aliases shorter than
# this (e.g. ``た社長``) are rejected because they are too easy to match
# inside unrelated noisy OCR text and risk false-positive normalization.
MIN_SAFE_ALIAS_LENGTH = 5

# Conservative static defaults. These cover OCR confusions that survive
# NFKC + ``一/-/_`` to ``ー`` normalization (see :func:`_normalize_name_for_match`),
# which is why we do not need to enumerate every hyphen variant. Production
# callers (job runner) should extend this with API-provided ``knownPlayerAliases``
# rather than relying on these worker-local fallbacks.
DEFAULT_STATIC_ALIASES: dict[str, tuple[str, ...]] = {
    "NO11社長": ("NO11社長",),
    "オータカ社長": ("オータカ社長", "おーたか社長", "おたか社長", "オー夕カ社長"),
    "いーゆー社長": ("いーゆー社長",),
    "ぽんた社長": ("ぽんた社長", "ほんた社長", "ぼんた社長"),
    "さくま社長": ("さくま社長", "さくぐま社長"),
}


@dataclass(frozen=True)
class PlayerAliasMatch:
    display_name: str
    member_id: str | None = None


@dataclass(frozen=True)
class ExtractedPlayerIdentity:
    raw_player_name: str | None
    member_id: str | None = None


@dataclass(frozen=True)
class PlayerAliasResolver:
    """Maps OCR-noisy ranked-row text to a display name and optional member id."""

    pairs: tuple[tuple[str, str, str | None], ...] = ()
    fuzzy_threshold: float | None = None

    def resolve(self, normalized_text: str) -> PlayerAliasMatch | None:
        best_match: PlayerAliasMatch | None = None
        best_ratio = 0.0
        for display_name, surface, member_id in self.pairs:
            normalized_surface = _normalize_name_for_match(surface)
            if len(normalized_surface) < MIN_SAFE_ALIAS_LENGTH:
                continue
            if normalized_surface in normalized_text:
                return PlayerAliasMatch(display_name=display_name, member_id=member_id)
            if self.fuzzy_threshold is not None:
                ratio = SequenceMatcher(None, normalized_surface, normalized_text).ratio()
                if ratio > best_ratio:
                    best_match = PlayerAliasMatch(display_name=display_name, member_id=member_id)
                    best_ratio = ratio
        if self.fuzzy_threshold is not None and best_ratio >= self.fuzzy_threshold:
            return best_match
        return None


def alias_resolver_from_map(
    aliases: Mapping[str, Sequence[str]],
    *,
    fuzzy_threshold: float | None = None,
) -> PlayerAliasResolver:
    pairs = tuple(
        (display_name, surface, None)
        for display_name, surfaces in aliases.items()
        for surface in _expand_momotetsu_president_surfaces(surfaces)
    )
    return PlayerAliasResolver(pairs=pairs, fuzzy_threshold=fuzzy_threshold)


def _expand_momotetsu_president_surfaces(surfaces: Sequence[str]) -> tuple[str, ...]:
    expanded: list[str] = []
    seen: set[str] = set()
    for surface in surfaces:
        candidates = [surface]
        if surface and not surface.endswith("社長"):
            candidates.append(f"{surface}社長")
        for candidate in candidates:
            if candidate not in seen:
                seen.add(candidate)
                expanded.append(candidate)
    return tuple(expanded)


def alias_resolver_from_member_aliases(
    aliases: Mapping[str, Sequence[str]],
    *,
    fuzzy_threshold: float | None = None,
) -> PlayerAliasResolver:
    pairs = tuple(
        (_display_name_from_aliases(member_id, surfaces), surface, member_id)
        for member_id, surfaces in aliases.items()
        for surface in _expand_momotetsu_president_surfaces(surfaces)
    )
    return PlayerAliasResolver(pairs=pairs, fuzzy_threshold=fuzzy_threshold)


DEFAULT_ALIAS_RESOLVER = alias_resolver_from_map(DEFAULT_STATIC_ALIASES)

KNOWN_PLAYER_ALIASES: Mapping[str, tuple[str, ...]] = DEFAULT_STATIC_ALIASES


def extract_player_name_candidate(
    text: str,
    *,
    alias_resolver: PlayerAliasResolver | None = None,
) -> str | None:
    return extract_player_identity(text, alias_resolver=alias_resolver).raw_player_name


def extract_player_identity(
    text: str,
    *,
    alias_resolver: PlayerAliasResolver | None = None,
) -> ExtractedPlayerIdentity:
    """Return a resolved or raw player display name candidate from row OCR text."""
    resolver = alias_resolver if alias_resolver is not None else DEFAULT_ALIAS_RESOLVER
    normalized = normalize_ocr_text(MONEY_TEXT_RE.sub(" ", text))
    if not normalized:
        return ExtractedPlayerIdentity(raw_player_name=None)
    alias_match = resolver.resolve(_normalize_name_for_match(normalized))
    if alias_match is not None:
        return ExtractedPlayerIdentity(
            raw_player_name=alias_match.display_name,
            member_id=alias_match.member_id,
        )

    matches = re.findall(r"((?:NO\s*1\s*1|[一-龥ぁ-んァ-ンー_]+)\s*社長)", normalized)
    if not matches:
        return ExtractedPlayerIdentity(raw_player_name=None)

    name = normalize_ocr_text(matches[-1]).replace("_", "ー")
    tokens = name.split()
    if len(tokens) >= MIN_NOISE_PREFIX_TOKENS and _is_latin_noise(tokens[0]):
        name = " ".join(tokens[1:])
    name = re.sub(r"(?<=\d)社長", " 社長", name)
    return ExtractedPlayerIdentity(raw_player_name=name or None)


def _display_name_from_aliases(member_id: str, surfaces: Sequence[str]) -> str:
    for surface in surfaces:
        if surface:
            return surface
    return member_id


def _normalize_name_for_match(value: str) -> str:
    normalized = normalize("NFKC", value)
    normalized = normalized.replace("_", "ー").replace("一", "ー").replace("-", "ー")
    return re.sub(r"[^0-9A-Za-zぁ-んァ-ン一-龥ー]", "", normalized).lower()


def _is_latin_noise(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]{1,3}", token))
