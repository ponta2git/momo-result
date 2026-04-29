from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.image_processing.geometry import Rect

PROFILE_ID = "full-hd-total-assets-v1"


@dataclass(frozen=True)
class TotalAssetsRowProfile:
    rank: int
    row_roi: Rect


ROW_PROFILES = (
    TotalAssetsRowProfile(rank=1, row_roi=Rect(x=0, y=200, width=1920, height=195)),
    TotalAssetsRowProfile(rank=2, row_roi=Rect(x=0, y=395, width=1920, height=195)),
    TotalAssetsRowProfile(rank=3, row_roi=Rect(x=0, y=585, width=1920, height=195)),
    TotalAssetsRowProfile(rank=4, row_roi=Rect(x=0, y=775, width=1920, height=195)),
)
