from __future__ import annotations

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.screen_detection.profiles import PROFILES
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

TITLE_OCR_VARIANTS = ((2, 6), (3, 6), (3, 7))


def recognize_title_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
) -> dict[ScreenType, str]:
    evidence: dict[ScreenType, str] = {}
    image_size = Size(width=image.width, height=image.height)
    for screen_type, profile in PROFILES.items():
        title_rect = scale_profile_rect_to_image(profile.title_roi, image_size)
        title_image = crop_roi(image, title_rect)
        evidence[screen_type] = _recognize_title_variants(title_image, engine)
    return evidence


def _recognize_title_variants(image: Image.Image, engine: TextRecognitionEngine) -> str:
    snippets: list[str] = []
    for scale_factor, psm in TITLE_OCR_VARIANTS:
        scaled = image.resize(
            (image.width * scale_factor, image.height * scale_factor),
            Image.Resampling.LANCZOS,
        )
        recognized = engine.recognize(scaled, field=RecognitionField.TITLE, psm=psm)
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
    return " | ".join(snippets)
