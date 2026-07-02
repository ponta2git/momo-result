from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageOps

from momo_ocr.features.player_order.name_matching import (
    remove_long_vowel_marks,
    strip_president_suffix,
)
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

NAME_OCR_PSMS = (6, 8)
NAME_WHITE_THRESHOLDS = (150, 170, 190)
NAME_VARIANT_SCALE = 2


def recognize_slot_name(
    image: Image.Image,
    *,
    text_engine: TextRecognitionEngine,
    debug_dir: Path | None = None,
    play_order: int | None = None,
) -> tuple[str | None, float | None]:
    candidates: list[tuple[str, float | None, float]] = []
    for variant_label, variant_image in _slot_name_variants(image):
        if debug_dir is not None and play_order is not None and variant_label != "raw":
            variant_image.save(debug_dir / f"order_{play_order}_name_{variant_label}.png")
        candidates.extend(_recognize_variant_candidates(variant_image, text_engine))

    if not candidates:
        return None, None
    name, confidence, _score = max(candidates, key=lambda item: item[2])
    return name, confidence


def _recognize_variant_candidates(
    image: Image.Image,
    text_engine: TextRecognitionEngine,
) -> list[tuple[str, float | None, float]]:
    candidates: list[tuple[str, float | None, float]] = []
    for psm in NAME_OCR_PSMS:
        recognized = text_engine.recognize(
            image,
            field=RecognitionField.PLAYER_NAME,
            config=RecognitionConfig(psm=psm),
        )
        cleaned = _clean_player_name(recognized.text)
        if cleaned is not None and not _is_name_noise(cleaned):
            candidates.append(
                (
                    cleaned,
                    recognized.confidence,
                    _name_candidate_score(cleaned, recognized.confidence),
                )
            )
    return candidates


def _clean_player_name(text: str) -> str | None:
    normalized = normalize_ocr_text(text).replace("_", "ー").replace("一", "ー")
    matches = re.findall(r"([A-Za-z0-9一-龥ぁ-んァ-ンー!！\s]+社長)", normalized)
    if not matches:
        return normalized or None
    return normalize_ocr_text(matches[-1]).replace("一", "ー")


def _slot_name_variants(image: Image.Image) -> list[tuple[str, Image.Image]]:
    variants = [("raw", image)]
    gray = ImageOps.grayscale(image)
    for threshold in NAME_WHITE_THRESHOLDS:
        prepared = gray.point(
            lambda value, threshold=threshold: 0 if value > threshold else 255
        ).convert("L")
        variants.append((f"white_{threshold}", _scaled_name_variant(prepared)))
    return variants


def _scaled_name_variant(image: Image.Image) -> Image.Image:
    return image.resize(
        (
            image.width * NAME_VARIANT_SCALE,
            image.height * NAME_VARIANT_SCALE,
        ),
        Image.Resampling.LANCZOS,
    )


def _name_candidate_score(name: str, confidence: float | None) -> float:
    score = confidence or 0.0
    if "社長" in name:
        score += 0.10
    if _has_mixed_kana(strip_president_suffix(name)):
        score -= 0.15
    if _looks_like_partial_company_suffix(name):
        score -= 0.05
    return score


def _has_mixed_kana(value: str) -> bool:
    has_hiragana = bool(re.search(r"[ぁ-ん]", value))
    has_katakana = bool(re.search(r"[ァ-ン]", value))
    return has_hiragana and has_katakana


def _looks_like_partial_company_suffix(name: str) -> bool:
    return "社" in name and "社長" not in name


def _is_name_noise(name: str) -> bool:
    non_marks = remove_long_vowel_marks(name).replace("-", "").strip()
    return len(non_marks) == 0
