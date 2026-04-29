from __future__ import annotations

from collections.abc import Mapping

from momo_ocr.features.ocr_domain.models import (
    OcrWarning,
    ScreenType,
    WarningCode,
    WarningSeverity,
)
from momo_ocr.features.screen_detection.models import ScreenDetectionResult
from momo_ocr.features.screen_detection.profiles import PROFILES, LayoutProfile

MIN_DETECTION_SCORE = 0.45
MIN_TABLE_KEYWORD_HITS = 2


def classify_screen_type(
    requested_type: ScreenType,
    evidence_by_type: Mapping[ScreenType, str],
) -> ScreenDetectionResult:
    if requested_type != ScreenType.AUTO:
        profile = PROFILES[requested_type]
        return ScreenDetectionResult(
            requested_type=requested_type,
            detected_type=requested_type,
            profile_id=profile.id,
            confidence=1.0,
            warnings=[],
        )

    detected_type, confidence = _score_evidence(evidence_by_type)
    if detected_type is None:
        return ScreenDetectionResult(
            requested_type=requested_type,
            detected_type=None,
            profile_id=None,
            confidence=0.0,
            warnings=[
                OcrWarning(
                    code=WarningCode.SCREEN_TYPE_UNDETECTED,
                    message="Screen type detection could not match known title keywords.",
                    severity=WarningSeverity.WARNING,
                )
            ],
            evidence_text=" | ".join(evidence_by_type.values()),
        )

    profile = PROFILES[detected_type]
    return ScreenDetectionResult(
        requested_type=requested_type,
        detected_type=detected_type,
        profile_id=profile.id,
        confidence=confidence,
        warnings=[],
        evidence_text=evidence_by_type[detected_type],
    )


def detection_failure(requested_type: ScreenType, *, message: str) -> ScreenDetectionResult:
    return ScreenDetectionResult(
        requested_type=requested_type,
        detected_type=None,
        profile_id=None,
        confidence=0.0,
        warnings=[
            OcrWarning(
                code=WarningCode.SCREEN_TYPE_DETECTION_FAILED,
                message=message,
                severity=WarningSeverity.WARNING,
            )
        ],
    )


def _score_evidence(evidence_by_type: Mapping[ScreenType, str]) -> tuple[ScreenType | None, float]:
    scored = [
        (screen_type, _score_profile_keywords(PROFILES[screen_type], evidence))
        for screen_type, evidence in evidence_by_type.items()
    ]
    if not scored:
        return None, 0.0
    best_type, best_score = max(scored, key=lambda item: item[1])
    if best_score < MIN_DETECTION_SCORE:
        return None, 0.0
    return best_type, best_score


def _score_profile_keywords(profile: LayoutProfile, evidence: str) -> float:
    compact = evidence.replace(" ", "")
    if any(keyword in compact for keyword in profile.title_keywords):
        return 1.0
    table_hits = sum(1 for keyword in profile.table_keywords if keyword in compact)
    if table_hits >= MIN_TABLE_KEYWORD_HITS:
        return min(0.9, 0.55 + (table_hits * 0.08))
    fragment_hits = sum(1 for fragment in profile.title_fragments if fragment in compact)
    if not profile.title_fragments or fragment_hits == 0:
        return 0.0
    return 0.45 + (0.3 * (fragment_hits / len(profile.title_fragments)))
