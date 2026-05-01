"""Cell-level OCR for the incident-log screen.

Crops, preprocessing variants and the per-PSM Tesseract calls live
here. Voting and plausibility decisions are factored into ``voting`` so
this module remains a thin engine driver.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.incident_log.attempts import CountRecognitionResult, PsmAttempt
from momo_ocr.features.incident_log.postprocess import is_pure_pipe_noise, parse_count
from momo_ocr.features.incident_log.voting import (
    max_plausible_cell_count,
    select_count_recognition,
    vote_count,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

COUNT_OCR_PSMS = (10, 13)
# 「|」「l」「i」のみで構成された OCR text は罫線の縦棒由来である可能性が高い。
# Tesseract の confidence がこの閾値未満の場合はノイズ扱いとし、digit 候補から外す。
PIPE_NOISE_CONFIDENCE_THRESHOLD = 0.6


def prepare_count_cell_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(4.0)
    return enhanced.resize((enhanced.width * 5, enhanced.height * 5), Image.Resampling.LANCZOS)


def prepare_fallback_count_cell_images(image: Image.Image) -> tuple[Image.Image, ...]:
    inner = image.crop((5, 2, image.width - 5, image.height - 2))
    gray = ImageOps.grayscale(inner)
    sharpened = ImageEnhance.Contrast(gray.filter(ImageFilter.SHARPEN)).enhance(5.0)
    # 固定閾値ではなく Otsu を使うことで、UI 配色に左右されずに前景文字を抽出する。
    binary = otsu_binarize(gray)
    return (
        sharpened.resize((inner.width * 5, inner.height * 5), Image.Resampling.LANCZOS),
        binary.resize((inner.width * 5, inner.height * 5), Image.Resampling.NEAREST),
    )


def recognize_count_cell(
    context: ScreenParseContext,
    image: Image.Image,
    *,
    incident_name: str,
    debug_dir: Path | None = None,
    debug_suffix: str | None = None,
    debug_sink: dict[str, Any] | None = None,
) -> CountRecognitionResult:
    """Recognise one incident-log count cell across primary + fallback variants.

    All variants are evaluated and combined via :func:`voting.select_count_recognition`
    so that primary's framing-noise misreads (e.g. ``"lo" → 10``) can be
    corrected by the fallback variants. Early-return is intentionally
    avoided.
    """
    max_count = max_plausible_cell_count(incident_name)
    primary_image = prepare_count_cell_image(image)
    fallback_images = prepare_fallback_count_cell_images(image)
    variant_specs = (
        ("primary", primary_image),
        ("fb_sharpened", fallback_images[0]),
        ("fb_otsu", fallback_images[1]),
    )
    if debug_dir is not None and debug_suffix is not None:
        # DEBUG: primary は既に上位で保存済みなので fallback だけ追加保存。
        for label, variant_image in variant_specs[1:]:
            variant_image.save(debug_dir / f"{debug_suffix}_{label}.png")

    primary_sink = _new_variant_sink("primary") if debug_sink is not None else None
    primary = _recognize_count_cell_image(context, primary_image, debug_sink=primary_sink)
    if debug_sink is not None and primary_sink is not None:
        debug_sink["variants"].append(primary_sink)

    fallback_results: list[CountRecognitionResult] = []
    for label, variant_image in variant_specs[1:]:
        variant_sink = _new_variant_sink(label) if debug_sink is not None else None
        result = _recognize_count_cell_image(context, variant_image, debug_sink=variant_sink)
        fallback_results.append(result)
        if debug_sink is not None and variant_sink is not None:
            debug_sink["variants"].append(variant_sink)

    return select_count_recognition(primary, fallback_results, max_plausible_count=max_count)


def _new_variant_sink(label: str) -> dict[str, Any]:
    return {"label": label, "psm_attempts": []}


def _recognize_count_cell_image(
    context: ScreenParseContext,
    image: Image.Image,
    *,
    debug_sink: dict[str, Any] | None = None,
) -> CountRecognitionResult:
    # 複数 PSM の結果を個別に parse_count してから多数決する。
    # 旧実装は raw_text を " | " で連結して parse_count に渡していたが、
    # parse_count は reversed で最後の候補を優先するため "0 | lo" → 10 の
    # ような後勝ち誤読が起きていた。
    attempts: list[PsmAttempt] = []
    snippets: list[str] = []
    for psm in COUNT_OCR_PSMS:
        recognized = context.text_engine.recognize(
            image,
            field=RecognitionField.INCIDENT_LOG,
            config=RecognitionConfig(
                language="eng",
                psm=psm,
                variables={"tessedit_char_whitelist": "0123456789OoIl|i"},
            ),
        )
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
        parsed = parse_count(text) if text else None
        # 罫線由来の縦棒ノイズを digit と取り違えるのを避ける。
        if (
            parsed is not None
            and is_pure_pipe_noise(text)
            and (recognized.confidence or 0.0) < PIPE_NOISE_CONFIDENCE_THRESHOLD
        ):
            parsed = None
        attempts.append(
            PsmAttempt(text=text, count=parsed, confidence=recognized.confidence)
        )
        if debug_sink is not None:
            debug_sink["psm_attempts"].append(
                {
                    "psm": psm,
                    "text": text,
                    "count": parsed,
                    "confidence": recognized.confidence,
                }
            )
    chosen_count, chosen_confidence = vote_count(attempts)
    if debug_sink is not None:
        debug_sink["chosen_count"] = chosen_count
        debug_sink["chosen_confidence"] = chosen_confidence
    return CountRecognitionResult(
        raw_text=" | ".join(snippets),
        count=chosen_count,
        confidence=chosen_confidence,
    )
