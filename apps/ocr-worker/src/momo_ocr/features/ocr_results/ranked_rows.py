from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

from momo_ocr.features.ocr_domain.money import MONEY_TEXT_RE
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

MIN_NOISE_PREFIX_TOKENS = 2
ROW_OCR_PSMS = (6, 11)


@dataclass(frozen=True)
class RankedRowOcrResult:
    text: str
    confidence: float | None


def prepare_ranked_row_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(2.0)
    return enhanced.resize((enhanced.width * 2, enhanced.height * 2), Image.Resampling.LANCZOS)


def recognize_ranked_row_text(
    image: Image.Image,
    *,
    text_engine: TextRecognitionEngine,
    fallback_image: Image.Image | None = None,
) -> RankedRowOcrResult:
    snippets: list[str] = []
    confidences: list[float] = []
    images = (image,) if fallback_image is None else (image, fallback_image)
    for candidate_image in images:
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
    confidence = min(confidences) if confidences else None
    return RankedRowOcrResult(text=" | ".join(snippets), confidence=confidence)


def save_debug_ranked_row(
    *,
    row_image: Image.Image,
    prepared_row: Image.Image,
    debug_dir: Path,
    rank: int,
) -> None:
    row_image.save(debug_dir / f"rank_{rank}_row.png")
    prepared_row.save(debug_dir / f"rank_{rank}_row_prepared.png")


def extract_player_name_candidate(text: str) -> str | None:
    normalized = normalize_ocr_text(MONEY_TEXT_RE.sub(" ", text))
    if not normalized:
        return None

    matches = re.findall(r"([A-Za-z0-9一-龥ぁ-んァ-ンー_\s]+社長)", normalized)
    if not matches:
        return None

    name = normalize_ocr_text(matches[-1]).replace("_", "ー")
    tokens = name.split()
    if len(tokens) >= MIN_NOISE_PREFIX_TOKENS and _is_latin_noise(tokens[0]):
        name = " ".join(tokens[1:])
    name = re.sub(r"(?<=\d)社長", " 社長", name)
    return name or None


def _is_latin_noise(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]{1,3}", token))
