from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from momo_ocr.features.image_processing.geometry import Rect

PROFILE_ID = "full-hd-incident-log-v1"
COMPACT_PROFILE_ID = "full-hd-incident-log-compact-v1"
MVP_INCIDENT_NAMES = ("目的地", "プラス駅", "マイナス駅", "カード駅", "カード売り場", "スリの銀次")


@dataclass(frozen=True)
class IncidentRowProfile:
    incident_name: str
    cell_rois: tuple[Rect, Rect, Rect, Rect]


@dataclass(frozen=True)
class IncidentLogProfile:
    id: str
    layout_families: tuple[str, ...]
    row_profiles: tuple[IncidentRowProfile, ...]


_CELL_XS = (878, 1148, 1418, 1680)
# 桃鉄ワールド (default) は cell 右側 20px 程度の余白で 98px に収まる。
# 桃鉄2 (compact) は緑シェブロン (V 字尖端) 形状のセル背景で、
# right edge の三角ノッチが二値化後に縦棒状の残渣となり OCR から digit と
# 誤認される (例: "1" → "11", "2" → "23") 現象が order=4 の cell で多発する。
# このため compact プロファイルだけ右端を ~20px 削り、シェブロン尖端を ROI
# 外に追い出す。compact の「2 桁値」の最大幅を確認した上で 78px は安全側。
_DEFAULT_CELL_WIDTH = 98
_COMPACT_CELL_WIDTH = 88
_CELL_HEIGHT = 75


def _build_row_profile(
    *, incident_name: str, y: int, cell_width: int = _DEFAULT_CELL_WIDTH
) -> IncidentRowProfile:
    return IncidentRowProfile(
        incident_name=incident_name,
        cell_rois=cast(
            "tuple[Rect, Rect, Rect, Rect]",
            tuple(Rect(x=x, y=y, width=cell_width, height=_CELL_HEIGHT) for x in _CELL_XS),
        ),
    )


DEFAULT_ROW_PROFILES = tuple(
    _build_row_profile(incident_name=incident_name, y=y, cell_width=_DEFAULT_CELL_WIDTH)
    for incident_name, y in zip(MVP_INCIDENT_NAMES, (330, 420, 510, 600, 690, 780), strict=True)
)
COMPACT_ROW_PROFILES = tuple(
    _build_row_profile(incident_name=incident_name, y=y, cell_width=_COMPACT_CELL_WIDTH)
    for incident_name, y in zip(MVP_INCIDENT_NAMES, (360, 450, 540, 630, 720, 810), strict=True)
)

PROFILES = (
    IncidentLogProfile(
        id=PROFILE_ID,
        layout_families=("world", "momotetsu_world", "default"),
        row_profiles=DEFAULT_ROW_PROFILES,
    ),
    IncidentLogProfile(
        id=COMPACT_PROFILE_ID,
        layout_families=("reiwa", "momotetsu_reiwa", "momotetsu_2", "momotetsu2", "2"),
        row_profiles=COMPACT_ROW_PROFILES,
    ),
)


def select_incident_log_profiles(layout_family_hint: str | None) -> tuple[IncidentLogProfile, ...]:
    if layout_family_hint is not None:
        normalized = layout_family_hint.strip().lower()
        for profile in PROFILES:
            if normalized in profile.layout_families:
                return (profile,)
    return PROFILES
