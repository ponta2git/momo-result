"""Tests for :class:`PlayerAliasResolver` and the conservative default map."""

from __future__ import annotations

from momo_ocr.features.player_identity.aliases import (
    DEFAULT_ALIAS_RESOLVER,
    DEFAULT_STATIC_ALIASES,
    MIN_SAFE_ALIAS_LENGTH,
    PlayerAliasResolver,
    alias_resolver_from_map,
    extract_player_identity,
)
from tests.support.parser_context import alias_resolver_from_members


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
    assert extract_player_identity('"7 た社長 6借5490万円').raw_player_name == "た社長"


def test_custom_alias_resolver_overrides_defaults() -> None:
    # API-supplied aliases must win over worker defaults so that production
    # callers can correct mis-pruned cases without modifying the worker.
    resolver = alias_resolver_from_map({"ハーゆー社長": ("ハーゆー社長",)})
    assert (
        extract_player_identity(
            "noise ハーゆー社長 800万円", alias_resolver=resolver
        ).raw_player_name
        == "ハーゆー社長"
    )


def test_hint_alias_resolver_maps_member_id() -> None:
    resolver = alias_resolver_from_members({"member_akane_mami": ("PONTA社長",)})

    identity = extract_player_identity(
        "なーーールーな Se se SE PONTA社長 148570044", alias_resolver=resolver
    )

    assert identity.raw_player_name == "PONTA社長"
    assert identity.member_id == "member_akane_mami"


def test_custom_alias_resolver_matches_momotetsu_president_suffix_without_seed() -> None:
    resolver = alias_resolver_from_map({"オータカ": ("オータカ",)})

    assert (
        extract_player_identity(
            "noise オータカ社長 800万円", alias_resolver=resolver
        ).raw_player_name
        == "オータカ"
    )


def test_default_alias_resolver_is_resolver_instance() -> None:
    assert isinstance(DEFAULT_ALIAS_RESOLVER, PlayerAliasResolver)


def test_default_alias_resolver_matches_momotetsu_2_name_noise() -> None:
    assert (
        extract_player_identity("a と & | ローゆー社長 2億6000万円").raw_player_name
        == "いーゆー社長"
    )
    assert (
        extract_player_identity("のシーンいと コーツ力社長 1800万円").raw_player_name
        == "オータカ社長"
    )
