"""Pure-data attempt structures used by the incident-log parser.

These dataclasses are intentionally pure data (no methods with side
effects). They flow from cell recognition into the voting layer and are
populated again on the orchestration layer when assembling the final
``OcrDraftPayload``. Using ``slots=True`` keeps allocation cheap on the
incident_log hot path (6 incidents × 4 cells × 3 variants × 2 PSMs per
image).
"""

from __future__ import annotations

from dataclasses import dataclass

from momo_ocr.features.incident_log.profile import IncidentLogProfile
from momo_ocr.features.ocr_domain.models import OcrField, OcrWarning


@dataclass(frozen=True, slots=True)
class PsmAttempt:
    """One Tesseract recognise call against a single (variant, PSM) pair."""

    text: str
    count: int | None
    confidence: float | None


@dataclass(frozen=True, slots=True)
class CountRecognitionResult:
    """Aggregated outcome for one variant or one cell."""

    raw_text: str
    count: int | None
    confidence: float | None


@dataclass(frozen=True, slots=True)
class IncidentParseAttempt:
    """One full attempt at parsing the screen using a single profile."""

    profile: IncidentLogProfile
    player_counts: list[dict[str, OcrField[int]]]
    warnings: list[OcrWarning]
    raw_snippets: dict[str, str]

    @property
    def missing_count(self) -> int:
        return sum(
            1 for counts in self.player_counts for field in counts.values() if field.value is None
        )
