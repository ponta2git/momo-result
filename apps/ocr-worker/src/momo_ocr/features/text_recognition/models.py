from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum

TextPostprocessor = Callable[[str], str]


class RecognitionField(StrEnum):
    GENERIC = "generic"
    TITLE = "title"
    MONEY = "money"
    PLAYER_NAME = "player_name"
    INCIDENT_LOG = "incident_log"


@dataclass(frozen=True)
class RecognitionConfig:
    language: str | None = None
    psm: int | None = None
    oem: int | None = None
    timeout_seconds: float | None = None
    variables: Mapping[str, str] = field(default_factory=dict)
    postprocessors: tuple[TextPostprocessor, ...] = ()


@dataclass(frozen=True)
class RecognizedText:
    text: str
    confidence: float | None
    raw_text: str | None = None
