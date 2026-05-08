from __future__ import annotations

import re
from dataclasses import dataclass
from typing import cast

from PIL import Image, ImageEnhance, ImageOps

from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.ocr_domain.money import MONEY_TEXT_RE
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

ROW_OCR_PSMS = (6, 7)
_INVERTED_LUMINANCE_THRESHOLD = 110.0


@dataclass(frozen=True)
class RankedRowOcrResult:
    text: str
    confidence: float | None


def prepare_ranked_row_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(2.0)
    return enhanced.resize((enhanced.width * 2, enhanced.height * 2), Image.Resampling.LANCZOS)


def prepare_ranked_row_image_variants(image: Image.Image) -> tuple[Image.Image, ...]:
    """Return preprocessed variants for ranked-row OCR."""
    variants: list[Image.Image] = []
    base = prepare_ranked_row_image(image)
    variants.append(base)
    if _is_inverted_text(image):
        variants.append(ImageOps.invert(base))
    variants.append(otsu_binarize(base))
    return tuple(variants)


def recognize_ranked_row_text(
    image: Image.Image,
    *,
    text_engine: TextRecognitionEngine,
    fallback_image: Image.Image | None = None,
) -> RankedRowOcrResult:
    """Run OCR over preprocessing variants until amount and name are recovered."""
    primary_variants = prepare_ranked_row_image_variants(image)
    secondary_variants: tuple[Image.Image, ...] = (
        (fallback_image,) if fallback_image is not None else ()
    )

    snippets: list[str] = []
    confidences: list[float] = []

    _run_variant(primary_variants[0], text_engine, snippets, confidences)
    _try_variants(primary_variants[1:], text_engine, snippets, confidences)
    if not _has_money_and_name(snippets):
        _try_variants(secondary_variants, text_engine, snippets, confidences)

    confidence = max(confidences) if confidences else None
    return RankedRowOcrResult(text=" | ".join(snippets), confidence=confidence)


def _is_inverted_text(image: Image.Image) -> bool:
    gray = ImageOps.grayscale(image)
    pixels = cast("tuple[int, ...]", gray.get_flattened_data())
    mean = sum(pixels) / len(pixels) if pixels else 255.0
    return mean < _INVERTED_LUMINANCE_THRESHOLD


def _try_variants(
    variants: tuple[Image.Image, ...],
    text_engine: TextRecognitionEngine,
    snippets: list[str],
    confidences: list[float],
) -> None:
    for variant in variants:
        if _has_money_and_name(snippets):
            return
        _run_variant(variant, text_engine, snippets, confidences)


def _run_variant(
    candidate_image: Image.Image,
    text_engine: TextRecognitionEngine,
    snippets: list[str],
    confidences: list[float],
) -> None:
    for psm in ROW_OCR_PSMS:
        recognized = text_engine.recognize(
            candidate_image,
            field=RecognitionField.GENERIC,
            config=RecognitionConfig(psm=psm),
        )
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
        if recognized.confidence is not None:
            confidences.append(recognized.confidence)


def _has_money_and_name(snippets: list[str]) -> bool:
    if not snippets:
        return False
    joined = " | ".join(snippets)
    if not MONEY_TEXT_RE.search(joined):
        return False
    return bool(re.search(r"社長", joined))
