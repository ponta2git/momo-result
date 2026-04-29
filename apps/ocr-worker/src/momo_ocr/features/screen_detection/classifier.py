from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_results.models import OcrWarning, WarningCode, WarningSeverity
from momo_ocr.features.screen_detection.models import DetectionResult, ImageType
from momo_ocr.features.screen_detection.profiles import PROFILES, LayoutProfile
from momo_ocr.features.temp_images.validation import open_decoded_image
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.shared.errors import OcrError

TITLE_OCR_VARIANTS = ((2, 6), (3, 6), (3, 7))


def detect_screen_type(
    path: Path,
    requested_type: ImageType,
    *,
    engine: TextRecognitionEngine | None = None,
) -> DetectionResult:
    if requested_type != ImageType.AUTO:
        profile = PROFILES[requested_type]
        return DetectionResult(
            requested_type=requested_type,
            detected_type=requested_type,
            profile_id=profile.id,
            confidence=1.0,
            warnings=[],
        )

    ocr_engine = engine if engine is not None else TesseractEngine()
    try:
        image = open_decoded_image(path)
        evidence_by_type = _recognize_title_evidence(image, ocr_engine)
    except OcrError as exc:
        return DetectionResult(
            requested_type=requested_type,
            detected_type=None,
            profile_id=None,
            confidence=0.0,
            warnings=[
                OcrWarning(
                    code=WarningCode.AUTO_DETECTION_UNCALIBRATED,
                    message=f"Image type auto-detection failed: {exc.message}",
                    severity=WarningSeverity.WARNING,
                )
            ],
        )

    detected_type, confidence = _score_evidence(evidence_by_type)
    if detected_type is None:
        return DetectionResult(
            requested_type=requested_type,
            detected_type=None,
            profile_id=None,
            confidence=0.0,
            warnings=[
                OcrWarning(
                    code=WarningCode.AUTO_DETECTION_UNCALIBRATED,
                    message="Image type auto-detection could not match known title keywords.",
                    severity=WarningSeverity.WARNING,
                )
            ],
            evidence_text=" | ".join(evidence_by_type.values()),
        )

    profile = PROFILES[detected_type]
    return DetectionResult(
        requested_type=requested_type,
        detected_type=detected_type,
        profile_id=profile.id,
        confidence=confidence,
        warnings=[],
        evidence_text=evidence_by_type[detected_type],
    )


def _recognize_title_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
) -> dict[ImageType, str]:
    evidence: dict[ImageType, str] = {}
    image_size = Size(width=image.width, height=image.height)
    for image_type, profile in PROFILES.items():
        title_rect = scale_profile_rect_to_image(profile.title_roi, image_size)
        title_image = crop_roi(image, title_rect)
        evidence[image_type] = _recognize_title_variants(title_image, engine)
    return evidence


def _recognize_title_variants(image: Image.Image, engine: TextRecognitionEngine) -> str:
    snippets: list[str] = []
    for scale_factor, psm in TITLE_OCR_VARIANTS:
        scaled = image.resize(
            (image.width * scale_factor, image.height * scale_factor),
            Image.Resampling.LANCZOS,
        )
        recognized = engine.recognize(scaled, psm=psm)
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
    return " | ".join(snippets)


def _score_evidence(evidence_by_type: dict[ImageType, str]) -> tuple[ImageType | None, float]:
    scored = [
        (image_type, _score_profile_keywords(PROFILES[image_type], evidence))
        for image_type, evidence in evidence_by_type.items()
    ]
    best_type, best_score = max(scored, key=lambda item: item[1])
    if best_score <= 0.0:
        return None, 0.0
    return best_type, best_score


def _score_profile_keywords(profile: LayoutProfile, evidence: str) -> float:
    compact = evidence.replace(" ", "")
    if any(keyword in compact for keyword in profile.title_keywords):
        return 1.0
    if all(fragment in compact for fragment in profile.title_fragments):
        return 0.75
    return 0.0
