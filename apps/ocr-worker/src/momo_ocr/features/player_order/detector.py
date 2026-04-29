from __future__ import annotations

from momo_ocr.features.player_order.models import PlayerColor, PlayerOrderDetection


def detect_default_order() -> PlayerOrderDetection:
    return PlayerOrderDetection(
        colors=[PlayerColor.BLUE, PlayerColor.RED, PlayerColor.YELLOW, PlayerColor.GREEN],
        confidence=0.0,
        warnings=["Color ROI detection is not implemented yet."],
    )
