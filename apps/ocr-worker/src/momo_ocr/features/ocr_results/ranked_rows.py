from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from unicodedata import normalize

from PIL import Image, ImageEnhance, ImageOps

from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.ocr_domain.money import MONEY_TEXT_RE
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

MIN_NOISE_PREFIX_TOKENS = 2
ROW_OCR_PSMS = (6, 7)
# Minimum normalized alias surface length. NFKC + lowercasing reduces
# canonical names like ``NO11社長`` to 5 characters. Aliases shorter than
# this (e.g. ``た社長``) are rejected because they are too easy to match
# inside unrelated noisy OCR text and risk false-positive normalization.
MIN_SAFE_ALIAS_LENGTH = 5

# Conservative static defaults. These cover OCR confusions that survive
# NFKC + ``一/-/_`` to ``ー`` normalization (see :func:`_normalize_name_for_match`),
# which is why we do not need to enumerate every hyphen variant. Production
# callers (job runner) should extend this with API-provided ``knownPlayerAliases``
# rather than relying on these worker-local fallbacks.
DEFAULT_STATIC_ALIASES: dict[str, tuple[str, ...]] = {
    "NO11社長": ("NO11社長",),
    "オータカ社長": ("オータカ社長", "おーたか社長", "おたか社長", "オー夕カ社長"),
    "いーゆー社長": ("いーゆー社長",),
    "ぽんた社長": ("ぽんた社長", "ほんた社長", "ぼんた社長"),
    "さくま社長": ("さくま社長", "さくぐま社長"),
}


@dataclass(frozen=True)
class PlayerAliasResolver:
    """Maps OCR-noisy ranked-row text to a canonical player display name.

    Resolution is exact-substring on normalized text by default. Fuzzy
    matching is opt-in via ``fuzzy_threshold`` and is only used when no exact
    match was found. Aliases shorter than :data:`MIN_SAFE_ALIAS_LENGTH` after
    normalization are silently ignored to prevent generic short tokens (e.g.
    ``た社長``, ``NO11``) from matching unrelated text.
    """

    pairs: tuple[tuple[str, str], ...] = ()
    fuzzy_threshold: float | None = None

    def resolve(self, normalized_text: str) -> str | None:
        best_canonical: str | None = None
        best_ratio = 0.0
        for canonical, surface in self.pairs:
            normalized_surface = _normalize_name_for_match(surface)
            if len(normalized_surface) < MIN_SAFE_ALIAS_LENGTH:
                continue
            if normalized_surface in normalized_text:
                return canonical
            if self.fuzzy_threshold is not None:
                ratio = SequenceMatcher(None, normalized_surface, normalized_text).ratio()
                if ratio > best_ratio:
                    best_canonical = canonical
                    best_ratio = ratio
        if self.fuzzy_threshold is not None and best_ratio >= self.fuzzy_threshold:
            return best_canonical
        return None


def alias_resolver_from_map(
    aliases: Mapping[str, Sequence[str]],
    *,
    fuzzy_threshold: float | None = None,
) -> PlayerAliasResolver:
    pairs = tuple(
        (canonical, surface) for canonical, surfaces in aliases.items() for surface in surfaces
    )
    return PlayerAliasResolver(pairs=pairs, fuzzy_threshold=fuzzy_threshold)


DEFAULT_ALIAS_RESOLVER = alias_resolver_from_map(DEFAULT_STATIC_ALIASES)


KNOWN_PLAYER_ALIASES: Mapping[str, tuple[str, ...]] = DEFAULT_STATIC_ALIASES


@dataclass(frozen=True)
class RankedRowOcrResult:
    text: str
    confidence: float | None


def prepare_ranked_row_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(2.0)
    return enhanced.resize((enhanced.width * 2, enhanced.height * 2), Image.Resampling.LANCZOS)


_INVERTED_LUMINANCE_THRESHOLD = 110.0


def _is_inverted_text(image: Image.Image) -> bool:
    """Return True when the image has a dark background and light text.

    Tesseract-jpn is calibrated for dark text on a light background.
    Several Momotetsu screens (e.g. revenue red banner, total-assets dark
    banner) have inverted polarity, so we detect this by comparing the mean
    luminance to a midline and emit an inverted variant when needed.
    """
    gray = ImageOps.grayscale(image)
    pixels = list(gray.getdata())
    mean = sum(pixels) / len(pixels) if pixels else 255.0
    return mean < _INVERTED_LUMINANCE_THRESHOLD


def _otsu_binarize(image: Image.Image) -> Image.Image:
    """Backwards-compatible wrapper around the shared Otsu utility."""
    return otsu_binarize(image)


def prepare_ranked_row_image_variants(image: Image.Image) -> tuple[Image.Image, ...]:
    """Return preprocessed variants for ranked-row OCR.

    Multiple variants give Tesseract independent shots at the same row
    without us having to lock in one global preprocessing pipeline. The
    base enhanced+upscaled image stays first because it tends to be most
    accurate for clean Full HD captures; OTSU and inversion fallbacks
    cover dark banners and JPEG-compressed text. Order is significant:
    callers iterate sequentially so the cheapest, highest-quality variant
    is tried first.
    """
    variants: list[Image.Image] = []
    base = prepare_ranked_row_image(image)
    variants.append(base)
    if _is_inverted_text(image):
        variants.append(ImageOps.invert(base))
    variants.append(_otsu_binarize(base))
    return tuple(variants)


def recognize_ranked_row_text(
    image: Image.Image,
    *,
    text_engine: TextRecognitionEngine,
    fallback_image: Image.Image | None = None,
) -> RankedRowOcrResult:
    """Run OCR over preprocessing variants until amount and name are recovered.

    The base image is always tried first. Additional variants (OTSU
    binarization, inversion, raw fallback) are added in successive passes
    only when the running snippet text still does not include both a money
    expression and a recognizable player-name token. This keeps the common
    case at three OCR invocations while giving hard cases extra recall
    without paying the full N-variant cost on every row.
    """
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

    # Variants are independent attempts at the same row. Use max instead of
    # min so a single failed preprocessing pass (confidence ~ 0) does not
    # erase the confidence of a successful one.
    confidence = max(confidences) if confidences else None
    return RankedRowOcrResult(text=" | ".join(snippets), confidence=confidence)


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
    # PSM 6 (uniform block) と PSM 7 (single line) は性能特性が補完的なので、
    # ここでは fast-path であっても両 PSM を回す。PSM 7 が PSM 6 で読めなかった
    # money/name を補うケースが eval で実測される (TA/REV ~1.8pt の差)。
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


def save_debug_ranked_row(
    *,
    row_image: Image.Image,
    prepared_row: Image.Image,
    debug_dir: Path,
    rank: int,
) -> None:
    row_image.save(debug_dir / f"rank_{rank}_row.png")
    prepared_row.save(debug_dir / f"rank_{rank}_row_prepared.png")


def extract_player_name_candidate(
    text: str,
    *,
    alias_resolver: PlayerAliasResolver | None = None,
) -> str | None:
    """Return a canonical or raw player display name candidate from row OCR text.

    ``alias_resolver`` defaults to :data:`DEFAULT_ALIAS_RESOLVER` (conservative
    static aliases for the fixed MVP roster). Production callers should build
    a resolver from API-provided ``knownPlayerAliases`` so worker-local
    fallbacks do not silently override per-game member configuration.
    """
    resolver = alias_resolver if alias_resolver is not None else DEFAULT_ALIAS_RESOLVER
    normalized = normalize_ocr_text(MONEY_TEXT_RE.sub(" ", text))
    if not normalized:
        return None
    alias_match = resolver.resolve(_normalize_name_for_match(normalized))
    if alias_match is not None:
        return alias_match

    matches = re.findall(r"((?:NO\s*1\s*1|[一-龥ぁ-んァ-ンー_]+)\s*社長)", normalized)
    if not matches:
        return None

    name = normalize_ocr_text(matches[-1]).replace("_", "ー")
    tokens = name.split()
    if len(tokens) >= MIN_NOISE_PREFIX_TOKENS and _is_latin_noise(tokens[0]):
        name = " ".join(tokens[1:])
    name = re.sub(r"(?<=\d)社長", " 社長", name)
    return name or None


def _normalize_name_for_match(value: str) -> str:
    normalized = normalize("NFKC", value)
    normalized = normalized.replace("_", "ー").replace("一", "ー").replace("-", "ー")
    return re.sub(r"[^0-9A-Za-zぁ-んァ-ン一-龥ー]", "", normalized).lower()


def _is_latin_noise(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]{1,3}", token))
