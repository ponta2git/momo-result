from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.image_processing.geometry import FULL_HD, Rect, Size
from momo_ocr.features.ocr_domain.models import ScreenType


@dataclass(frozen=True)
class LayoutProfile:
    id: str
    screen_type: ScreenType
    title_roi: Rect
    title_keywords: tuple[str, ...]
    title_fragments: tuple[str, ...]
    table_keywords: tuple[str, ...] = ()
    expected_size: Size = FULL_HD


PROFILES: dict[ScreenType, LayoutProfile] = {
    ScreenType.TOTAL_ASSETS: LayoutProfile(
        id="full-hd-total-assets-v1",
        screen_type=ScreenType.TOTAL_ASSETS,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("総資産", "総資"),
        title_fragments=("総", "資"),
    ),
    ScreenType.REVENUE: LayoutProfile(
        id="full-hd-revenue-v1",
        screen_type=ScreenType.REVENUE,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("収益額", "収普額", "収普"),
        title_fragments=("額",),
    ),
    ScreenType.INCIDENT_LOG: LayoutProfile(
        id="full-hd-incident-log-v1",
        screen_type=ScreenType.INCIDENT_LOG,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("桃鉄事件簿", "桃鉄事件等", "鉄事件等", "鉄事件"),
        title_fragments=("桃", "鉄", "事件"),
        table_keywords=("目的地", "プラス駅", "マイナス駅", "カード駅", "売り場", "銀次"),
    ),
}
