"""Tests for :class:`PlayerAliasResolver` and the conservative default map."""

from __future__ import annotations

from momo_ocr.features.ocr_results.ranked_rows import (
    DEFAULT_ALIAS_RESOLVER,
    DEFAULT_STATIC_ALIASES,
    MIN_SAFE_ALIAS_LENGTH,
    PlayerAliasResolver,
    alias_resolver_from_map,
    extract_player_name_candidate,
)


def test_default_static_aliases_drop_unsafe_short_surfaces() -> None:
    # The conservative defaults must not include short tokens that match
    # unrelated noise (``た社長`` is only 3 characters after normalization,
    # ``NO11`` without 社長 collides with anything containing the digits).
    for canonical, surfaces in DEFAULT_STATIC_ALIASES.items():
        assert canonical.endswith("社長") or canonical == "さくま社長"
        for surface in surfaces:
            assert len(surface) >= MIN_SAFE_ALIAS_LENGTH, (
                f"{canonical} -> {surface!r} would normalize below the safe length"
            )


def test_default_resolver_does_not_match_unrelated_short_tokens() -> None:
    # Without the historical ``た社長`` short alias, raw OCR text containing
    # only ``た社長`` must fall back to the regex extraction (raw token)
    # instead of being normalized to ``ぽんた社長``. This protects against
    # false-positive normalization for genuinely different player names.
    assert extract_player_name_candidate('"7 た社長 6借5490万円') == "た社長"


def test_custom_alias_resolver_overrides_defaults() -> None:
    # API-supplied aliases must win over worker defaults so that production
    # callers can correct mis-pruned cases without modifying the worker.
    resolver = alias_resolver_from_map({"ハーゆー社長": ("ハーゆー社長",)})
    assert (
        extract_player_name_candidate("noise ハーゆー社長 800万円", alias_resolver=resolver)
        == "ハーゆー社長"
    )


def test_default_alias_resolver_is_resolver_instance() -> None:
    assert isinstance(DEFAULT_ALIAS_RESOLVER, PlayerAliasResolver)
