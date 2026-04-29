from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.image_processing.geometry import FULL_HD, Rect, Size
from momo_ocr.features.screen_detection.models import ImageType


@dataclass(frozen=True)
class LayoutProfile:
    id: str
    image_type: ImageType
    title_roi: Rect
    title_keywords: tuple[str, ...]
    title_fragments: tuple[str, ...]
    expected_size: Size = FULL_HD


PROFILES: dict[ImageType, LayoutProfile] = {
    ImageType.TOTAL_ASSETS: LayoutProfile(
        id="full-hd-total-assets-v1",
        image_type=ImageType.TOTAL_ASSETS,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("総資産",),
        title_fragments=("総", "資"),
    ),
    ImageType.REVENUE: LayoutProfile(
        id="full-hd-revenue-v1",
        image_type=ImageType.REVENUE,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("収益額",),
        title_fragments=("収", "額"),
    ),
    ImageType.INCIDENT_LOG: LayoutProfile(
        id="full-hd-incident-log-v1",
        image_type=ImageType.INCIDENT_LOG,
        title_roi=Rect(x=75, y=15, width=1200, height=165),
        title_keywords=("桃鉄事件簿",),
        title_fragments=("桃", "鉄", "事件"),
    ),
}
