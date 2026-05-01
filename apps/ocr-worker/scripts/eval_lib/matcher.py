"""Match an expected player row to one of the four predicted player drafts.

answers.tsv の表記と OCR が返す canonical 名 (DEFAULT_STATIC_ALIASES) を結びつけ、
play_order 検出が外れた行を name ベースで救済するための薄いマッピングを提供する。
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from eval_lib.types import ExpectedPlayer
from momo_ocr.features.ocr_domain.models import OcrDraftPayload, PlayerResultDraft


@dataclass(frozen=True, slots=True)
class NameFragmentTable:
    """Roster name → OCR name fragments (NFKC-lowercased on lookup)."""

    fragments: dict[str, tuple[str, ...]]

    def lookup(self, expected_name: str) -> tuple[str, ...]:
        return self.fragments.get(expected_name, (expected_name,))


_DEFAULT_TABLE = NameFragmentTable(
    fragments={
        "おーたか": ("おーたか", "おたか", "オータカ", "オタカ", "オー夕カ"),
        "いーゆー": ("いーゆー", "いーゆ", "イーユー", "イーユ"),
        "ぽんた": ("ぽんた", "ほんた", "ぼんた", "ポンタ"),
        "あかねまみ": ("あかねまみ", "アカネマミ", "no11", "ＮＯ１１"),
        "さくま": ("さくま", "サクマ"),
    },
)


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    for suffix in ("社長", "さん"):
        normalized = normalized.replace(suffix, "")
    return "".join(ch for ch in normalized if not ch.isspace())


def _player_by_play_order(payload: OcrDraftPayload, play_order: int) -> PlayerResultDraft | None:
    for player in payload.players:
        if player.play_order.value == play_order:
            return player
    return None


def _player_by_name(
    payload: OcrDraftPayload,
    expected_name: str,
    table: NameFragmentTable = _DEFAULT_TABLE,
) -> PlayerResultDraft | None:
    fragments = table.lookup(expected_name)
    norm_fragments = [_normalize_name(f) for f in fragments]
    for player in payload.players:
        raw = player.raw_player_name.value
        if raw is None:
            continue
        norm_raw = _normalize_name(raw)
        if any(frag and frag in norm_raw for frag in norm_fragments):
            return player
    return None


def resolve_player(
    payload: OcrDraftPayload,
    expected: ExpectedPlayer,
    table: NameFragmentTable = _DEFAULT_TABLE,
) -> tuple[PlayerResultDraft | None, str]:
    """Match expected → predicted player. Returns (player, match_kind).

    match_kind: 'play_order' | 'name' | 'none'
    """
    by_order = _player_by_play_order(payload, expected.play_order)
    if by_order is not None:
        return by_order, "play_order"
    by_name = _player_by_name(payload, expected.name, table)
    if by_name is not None:
        return by_name, "name"
    return None, "none"
