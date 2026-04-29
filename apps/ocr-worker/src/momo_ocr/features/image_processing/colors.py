from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rgb:
    red: int
    green: int
    blue: int
