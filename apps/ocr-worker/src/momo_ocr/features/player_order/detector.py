from __future__ import annotations

import colorsys
import re
from collections.abc import Iterable
from dataclasses import replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import cast

from PIL import Image, ImageOps

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import (
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    WarningCode,
)
from momo_ocr.features.player_order.models import (
    PlayerColor,
    PlayerOrderDetection,
    PlayerOrderSlot,
)
from momo_ocr.features.player_order.profile import SLOT_PROFILES
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

MIN_COLOR_CONFIDENCE = 0.45
MIN_NAME_MATCH_LENGTH = 3
MIN_NAME_SIMILARITY = 0.65
MIN_SATURATION = 0.45
MIN_VALUE = 0.25
NAME_OCR_PSMS = (6, 8)
NAME_WHITE_THRESHOLDS = (150, 170, 190)
NAME_VARIANT_SCALE = 2
RED_HUE_MAX = 20
RED_HUE_MIN = 330
YELLOW_HUE_MIN = 30
YELLOW_HUE_MAX = 65
GREEN_HUE_MIN = 75
GREEN_HUE_MAX = 130
BLUE_HUE_MIN = 185
BLUE_HUE_MAX = 240
COLOR_HUE_RANGES = (
    (PlayerColor.RED, ((0, RED_HUE_MAX), (RED_HUE_MIN, 360))),
    (PlayerColor.YELLOW, ((YELLOW_HUE_MIN, YELLOW_HUE_MAX),)),
    (PlayerColor.GREEN, ((GREEN_HUE_MIN, GREEN_HUE_MAX),)),
    (PlayerColor.BLUE, ((BLUE_HUE_MIN, BLUE_HUE_MAX),)),
)
NAME_CONFUSION_REPLACEMENTS = (
    ("いローゆ", "いーゆ"),
    ("いハーゆ", "いーゆ"),
    ("ハーゆ", "いーゆ"),
    ("バーゆ", "いーゆ"),
)


def detect_player_order(
    image: Image.Image,
    *,
    text_engine: TextRecognitionEngine,
    debug_dir: Path | None = None,
) -> PlayerOrderDetection:
    image_size = Size(width=image.width, height=image.height)
    slots: list[PlayerOrderSlot] = []
    warnings: list[OcrWarning] = []
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)

    for slot_profile in SLOT_PROFILES:
        indicator_image = crop_roi(
            image,
            scale_profile_rect_to_image(slot_profile.indicator_roi, image_size),
        )
        name_image = crop_roi(
            image,
            scale_profile_rect_to_image(slot_profile.name_roi, image_size),
        )
        if debug_dir is not None:
            indicator_image.save(debug_dir / f"order_{slot_profile.play_order}_indicator.png")
            name_image.save(debug_dir / f"order_{slot_profile.play_order}_name.png")

        detected_color, color_confidence = _detect_dominant_player_color(indicator_image)
        raw_player_name, name_confidence = _recognize_slot_name(
            name_image,
            text_engine=text_engine,
            debug_dir=debug_dir,
            play_order=slot_profile.play_order,
        )

        if detected_color != slot_profile.expected_color or color_confidence < MIN_COLOR_CONFIDENCE:
            warnings.append(
                OcrWarning(
                    code=WarningCode.PLAYER_ORDER_UNDETECTED,
                    message=(
                        f"Could not confidently detect {slot_profile.expected_color.value} "
                        f"indicator for play order {slot_profile.play_order}."
                    ),
                    field_path=f"player_order[{slot_profile.play_order - 1}].detected_color",
                )
            )

        slots.append(
            PlayerOrderSlot(
                play_order=slot_profile.play_order,
                expected_color=slot_profile.expected_color,
                detected_color=detected_color,
                raw_player_name=raw_player_name,
                color_confidence=color_confidence,
                name_confidence=name_confidence,
            )
        )

    confidences = [slot.color_confidence for slot in slots]
    return PlayerOrderDetection(
        slots=slots,
        confidence=min(confidences) if confidences else 0.0,
        warnings=warnings,
    )


def apply_player_order_to_ranked_players(
    players: list[PlayerResultDraft],
    detection: PlayerOrderDetection | None,
) -> list[PlayerResultDraft]:
    if detection is None:
        return players
    return [_apply_order_by_name(player, detection) for player in players]


def apply_player_order_to_column_players(
    players: list[PlayerResultDraft],
    detection: PlayerOrderDetection | None,
) -> list[PlayerResultDraft]:
    if detection is None:
        return players
    updated: list[PlayerResultDraft] = []
    for index, player in enumerate(players):
        if index >= len(detection.slots):
            updated.append(player)
            continue
        slot = detection.slots[index]
        raw_player_name = player.raw_player_name
        if raw_player_name.value is None and slot.raw_player_name is not None:
            raw_player_name = OcrField(
                value=slot.raw_player_name,
                raw_text=slot.raw_player_name,
                confidence=slot.name_confidence,
            )
        updated.append(
            replace(
                player,
                raw_player_name=raw_player_name,
                play_order=OcrField(
                    value=slot.play_order,
                    raw_text=slot.expected_color.value,
                    confidence=slot.color_confidence,
                ),
            )
        )
    return updated


def _apply_order_by_name(
    player: PlayerResultDraft,
    detection: PlayerOrderDetection,
) -> PlayerResultDraft:
    player_name = player.raw_player_name.value
    if player_name is None:
        return player
    matched_slot = _find_matching_slot(player_name, detection.slots)
    if matched_slot is None:
        return player
    return replace(
        player,
        play_order=OcrField(
            value=matched_slot.play_order,
            raw_text=matched_slot.raw_player_name,
            confidence=matched_slot.color_confidence,
        ),
    )


def _find_matching_slot(
    player_name: str,
    slots: list[PlayerOrderSlot],
) -> PlayerOrderSlot | None:
    normalized_player = _normalize_name_for_match(player_name)
    if len(normalized_player) < MIN_NAME_MATCH_LENGTH:
        return None
    for slot in slots:
        if slot.raw_player_name is None:
            continue
        normalized_slot = _normalize_name_for_match(slot.raw_player_name)
        if (
            normalized_player in normalized_slot
            or normalized_slot in normalized_player
            or _strip_president_suffix(normalized_player) in normalized_slot
            or _remove_long_vowel_marks(_strip_president_suffix(normalized_player))
            in _remove_long_vowel_marks(normalized_slot)
            or _name_similarity(normalized_player, normalized_slot) >= MIN_NAME_SIMILARITY
        ):
            return slot
    return None


def _detect_dominant_player_color(image: Image.Image) -> tuple[PlayerColor | None, float]:
    counts = dict.fromkeys(PlayerColor, 0)
    saturated_count = 0
    rgb_image = image.convert("RGB")
    pixels = cast("Iterable[tuple[int, int, int]]", rgb_image.get_flattened_data())
    for red, green, blue in pixels:
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        if saturation < MIN_SATURATION or value < MIN_VALUE:
            continue
        saturated_count += 1
        color = _classify_hue(hue * 360)
        if color is not None:
            counts[color] += 1

    if saturated_count == 0:
        return None, 0.0
    detected_color, count = max(counts.items(), key=lambda item: item[1])
    return detected_color, count / saturated_count


def _recognize_slot_name(
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
        for psm in NAME_OCR_PSMS:
            recognized = text_engine.recognize(
                variant_image,
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

    if candidates:
        name, confidence, _score = max(candidates, key=lambda item: item[2])
        return name, confidence
    return None, None


def _classify_hue(hue: float) -> PlayerColor | None:
    for color, ranges in COLOR_HUE_RANGES:
        if any(start <= hue <= end for start, end in ranges):
            return color
    return None


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
        variants.append(
            (
                f"white_{threshold}",
                prepared.resize(
                    (
                        prepared.width * NAME_VARIANT_SCALE,
                        prepared.height * NAME_VARIANT_SCALE,
                    ),
                    Image.Resampling.LANCZOS,
                ),
            )
        )
    return variants


def _name_candidate_score(name: str, confidence: float | None) -> float:
    score = confidence or 0.0
    if "社長" in name:
        score += 0.10
    if _has_mixed_kana(_strip_president_suffix(name)):
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
    non_marks = name.replace("ー", "").replace("-", "").strip()
    return len(non_marks) == 0


def _normalize_name_for_match(name: str) -> str:
    normalized = name.replace("一", "ー").replace("_", "ー")
    for source, replacement in NAME_CONFUSION_REPLACEMENTS:
        normalized = normalized.replace(source, replacement)
    return re.sub(r"[^A-Za-z0-9一-龥ぁ-んァ-ンー]", "", normalized)


def _strip_president_suffix(name: str) -> str:
    return name.removesuffix("社長")


def _remove_long_vowel_marks(name: str) -> str:
    return name.replace("ー", "")


def _name_similarity(left: str, right: str) -> float:
    left_core = _remove_long_vowel_marks(_strip_president_suffix(left))
    right_core = _remove_long_vowel_marks(_strip_president_suffix(right))
    if len(left_core) < MIN_NAME_MATCH_LENGTH or len(right_core) < MIN_NAME_MATCH_LENGTH:
        return 0.0
    return SequenceMatcher(a=left_core, b=right_core).ratio()
