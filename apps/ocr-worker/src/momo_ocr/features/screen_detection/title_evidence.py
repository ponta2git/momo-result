from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.image_processing.geometry import Rect, Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.screen_detection.profiles import PROFILES
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

TITLE_OCR_VARIANTS = ((2, 6), (3, 6), (3, 7))
SUPPLEMENTAL_EVIDENCE_ROIS = (
    ("top_wide", Rect(x=0, y=0, width=1920, height=270)),
    ("header_mid", Rect(x=120, y=0, width=1350, height=255)),
    ("table_wide", Rect(x=0, y=255, width=1920, height=630)),
)


def recognize_title_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    debug_dir: Path | None = None,
) -> dict[ScreenType, str]:
    evidence: dict[ScreenType, str] = {}
    image_size = Size(width=image.width, height=image.height)
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)
    for screen_type, profile in PROFILES.items():
        title_rect = scale_profile_rect_to_image(profile.title_roi, image_size)
        title_image = crop_roi(image, title_rect)
        if debug_dir is not None:
            title_image.save(debug_dir / f"{screen_type.value}_title.png")
        evidence[screen_type] = _recognize_title_variants(
            title_image,
            engine,
            debug_dir=debug_dir,
            debug_prefix=screen_type.value,
        )
    supplemental_evidence = _recognize_supplemental_evidence(
        image,
        engine,
        image_size=image_size,
        debug_dir=debug_dir,
    )
    if supplemental_evidence:
        evidence = {
            screen_type: _join_unique_snippets((text, supplemental_evidence))
            for screen_type, text in evidence.items()
        }
    return evidence


def _recognize_title_variants(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    debug_dir: Path | None,
    debug_prefix: str,
) -> str:
    snippets: list[str] = []
    for scale_factor, psm in TITLE_OCR_VARIANTS:
        scaled = image.resize(
            (image.width * scale_factor, image.height * scale_factor),
            Image.Resampling.LANCZOS,
        )
        if debug_dir is not None:
            scaled.save(debug_dir / f"{debug_prefix}_title_scale{scale_factor}_psm{psm}.png")
        recognized = engine.recognize(scaled, field=RecognitionField.TITLE, psm=psm)
        text = normalize_ocr_text(recognized.text)
        if text:
            snippets.append(text)
    return _join_unique_snippets(snippets)


def _recognize_supplemental_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    image_size: Size,
    debug_dir: Path | None,
) -> str:
    snippets: list[str] = []
    for name, roi in SUPPLEMENTAL_EVIDENCE_ROIS:
        rect = scale_profile_rect_to_image(roi, image_size)
        crop = crop_roi(image, rect)
        scaled = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
        if debug_dir is not None:
            crop.save(debug_dir / f"supplemental_{name}.png")
            scaled.save(debug_dir / f"supplemental_{name}_scale2.png")
        for psm in (6, 11):
            recognized = engine.recognize(scaled, field=RecognitionField.TITLE, psm=psm)
            text = normalize_ocr_text(recognized.text)
            if text:
                snippets.append(text)
    return _join_unique_snippets(snippets)


def _join_unique_snippets(snippets: tuple[str, ...] | list[str]) -> str:
    unique: list[str] = []
    for snippet in snippets:
        if snippet and snippet not in unique:
            unique.append(snippet)
    return " | ".join(unique)
