from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageOps

from momo_ocr.features.image_processing.geometry import Rect, Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.parser_core.debug import NULL_DEBUG_SINK, DebugSink
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

_HIRAGANA_KATAKANA_RANGE = (0x3040, 0x30FF)
_CJK_UNIFIED_RANGE = (0x4E00, 0x9FFF)


@dataclass(frozen=True)
class _TitleVariantRequest:
    variant_label: str
    scale_factor: int
    psm: int
    debug_sink: DebugSink
    debug_prefix: str


def recognize_title_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    debug_sink: DebugSink = NULL_DEBUG_SINK,
) -> dict[ScreenType, str]:
    evidence: dict[ScreenType, str] = {}
    image_size = Size(width=image.width, height=image.height)
    for screen_type, profile in PROFILES.items():
        title_rect = scale_profile_rect_to_image(profile.title_roi, image_size)
        title_image = crop_roi(image, title_rect)
        debug_sink.save_image(f"{screen_type.value}_title.png", title_image)
        evidence[screen_type] = _recognize_title_variants(
            title_image,
            engine,
            debug_sink=debug_sink,
            debug_prefix=screen_type.value,
        )
    supplemental_evidence = _recognize_supplemental_evidence(
        image,
        engine,
        image_size=image_size,
        debug_sink=debug_sink,
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
    debug_sink: DebugSink,
    debug_prefix: str,
) -> str:
    snippets: list[str] = []
    preprocessed_variants = _title_preprocessing_variants(image)
    for variant_label, variant_image in preprocessed_variants:
        variant_snippets = _recognize_title_variant_group(
            variant_image,
            engine,
            variant_label=variant_label,
            debug_sink=debug_sink,
            debug_prefix=debug_prefix,
        )
        snippets.extend(variant_snippets)
        # Lazy variant evaluation: if the base preprocessing already produced
        # CJK title evidence, skip the heavier OTSU/invert variants. Stylized
        # banners (e.g. 桃鉄2) typically need fallbacks; clean banners
        # (e.g. 令和/ワールド) succeed at base and do not benefit from them.
        if variant_label == "base" and _has_cjk(variant_snippets):
            break
    return _join_unique_snippets(snippets)


def _recognize_title_variant_group(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    variant_label: str,
    debug_sink: DebugSink,
    debug_prefix: str,
) -> list[str]:
    snippets: list[str] = []
    for scale_factor, psm in TITLE_OCR_VARIANTS:
        text = _recognize_scaled_title(
            image,
            engine,
            request=_TitleVariantRequest(
                variant_label=variant_label,
                scale_factor=scale_factor,
                psm=psm,
                debug_sink=debug_sink,
                debug_prefix=debug_prefix,
            ),
        )
        if text:
            snippets.append(text)
    return snippets


def _recognize_scaled_title(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    request: _TitleVariantRequest,
) -> str:
    scaled = image.resize(
        (image.width * request.scale_factor, image.height * request.scale_factor),
        Image.Resampling.LANCZOS,
    )
    _save_scaled_title_debug(scaled, request=request)
    recognized = engine.recognize(scaled, field=RecognitionField.TITLE, psm=request.psm)
    return normalize_ocr_text(recognized.text)


def _save_scaled_title_debug(
    scaled: Image.Image,
    *,
    request: _TitleVariantRequest,
) -> None:
    request.debug_sink.save_image(
        (
            f"{request.debug_prefix}_title_{request.variant_label}_"
            f"scale{request.scale_factor}_psm{request.psm}.png"
        ),
        scaled,
    )


def _has_cjk(snippets: list[str]) -> bool:
    return any(_is_cjk_or_kana(char) for snippet in snippets for char in snippet)


def _is_cjk_or_kana(char: str) -> bool:
    hira_lo, hira_hi = _HIRAGANA_KATAKANA_RANGE
    cjk_lo, cjk_hi = _CJK_UNIFIED_RANGE
    code = ord(char)
    return hira_lo <= code <= hira_hi or cjk_lo <= code <= cjk_hi


def _title_preprocessing_variants(image: Image.Image) -> tuple[tuple[str, Image.Image], ...]:
    """Return preprocessing variants that help OCR read stylized title banners.

    The base image is always tried first. OTSU binarization is added because
    decorative title banners (e.g. Momotetsu 2 striped backgrounds) defeat
    Tesseract's default adaptive thresholding. Inverted variants help dark
    banners with light text.
    """
    grayscale = ImageOps.grayscale(image)
    return (
        ("base", image),
        ("otsu", otsu_binarize(image)),
        ("invert", ImageOps.invert(grayscale)),
    )


def _recognize_supplemental_evidence(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    image_size: Size,
    debug_sink: DebugSink,
) -> str:
    snippets: list[str] = []
    for name, roi in SUPPLEMENTAL_EVIDENCE_ROIS:
        snippets.extend(
            _recognize_supplemental_roi(
                image,
                engine,
                name=name,
                roi=roi,
                image_size=image_size,
                debug_sink=debug_sink,
            )
        )
    return _join_unique_snippets(snippets)


def _recognize_supplemental_roi(
    image: Image.Image,
    engine: TextRecognitionEngine,
    *,
    name: str,
    roi: Rect,
    image_size: Size,
    debug_sink: DebugSink,
) -> list[str]:
    rect = scale_profile_rect_to_image(roi, image_size)
    crop = crop_roi(image, rect)
    scaled = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
    _save_supplemental_debug(crop, scaled, name=name, debug_sink=debug_sink)
    return _recognize_supplemental_variants(scaled, engine)


def _save_supplemental_debug(
    crop: Image.Image,
    scaled: Image.Image,
    *,
    name: str,
    debug_sink: DebugSink,
) -> None:
    debug_sink.save_image(f"supplemental_{name}.png", crop)
    debug_sink.save_image(f"supplemental_{name}_scale2.png", scaled)


def _recognize_supplemental_variants(
    scaled: Image.Image,
    engine: TextRecognitionEngine,
) -> list[str]:
    snippets: list[str] = []
    for psm in (6, 11):
        recognized = engine.recognize(scaled, field=RecognitionField.TITLE, psm=psm)
        text = normalize_ocr_text(recognized.text)
        if text:
            snippets.append(text)
    return snippets


def _join_unique_snippets(snippets: tuple[str, ...] | list[str]) -> str:
    unique: list[str] = []
    for snippet in snippets:
        if snippet and snippet not in unique:
            unique.append(snippet)
    return " | ".join(unique)
