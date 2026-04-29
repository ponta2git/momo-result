from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class PlayerColor(StrEnum):
    BLUE = "blue"
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


@dataclass(frozen=True)
class PlayerOrderDetection:
    colors: list[PlayerColor]
    confidence: float
    warnings: list[str]
