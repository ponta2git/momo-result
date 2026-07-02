from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import (
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    WarningCode,
)
from momo_ocr.features.player_order.color_detection import (
    MIN_COLOR_CONFIDENCE,
    detect_dominant_player_color,
)
from momo_ocr.features.player_order.models import PlayerOrderDetection, PlayerOrderSlot
from momo_ocr.features.player_order.name_matching import find_matching_slot
from momo_ocr.features.player_order.name_recognition import recognize_slot_name
from momo_ocr.features.player_order.profile import SLOT_PROFILES, PlayerOrderSlotProfile
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine


@dataclass(frozen=True)
class _SlotImages:
    indicator: Image.Image
    name: Image.Image


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
        slot_images = _crop_slot_images(image, image_size=image_size, slot_profile=slot_profile)
        _save_slot_debug_images(slot_images, slot_profile=slot_profile, debug_dir=debug_dir)
        slot = _detect_slot(
            slot_images,
            slot_profile=slot_profile,
            text_engine=text_engine,
            debug_dir=debug_dir,
        )
        warnings.extend(_slot_warnings(slot, slot_profile))
        slots.append(slot)

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
    return [
        _apply_column_slot(player, detection.slots[index] if index < len(detection.slots) else None)
        for index, player in enumerate(players)
    ]


def _crop_slot_images(
    image: Image.Image,
    *,
    image_size: Size,
    slot_profile: PlayerOrderSlotProfile,
) -> _SlotImages:
    return _SlotImages(
        indicator=crop_roi(
            image,
            scale_profile_rect_to_image(slot_profile.indicator_roi, image_size),
        ),
        name=crop_roi(
            image,
            scale_profile_rect_to_image(slot_profile.name_roi, image_size),
        ),
    )


def _save_slot_debug_images(
    slot_images: _SlotImages,
    *,
    slot_profile: PlayerOrderSlotProfile,
    debug_dir: Path | None,
) -> None:
    if debug_dir is None:
        return
    slot_images.indicator.save(debug_dir / f"order_{slot_profile.play_order}_indicator.png")
    slot_images.name.save(debug_dir / f"order_{slot_profile.play_order}_name.png")


def _detect_slot(
    slot_images: _SlotImages,
    *,
    slot_profile: PlayerOrderSlotProfile,
    text_engine: TextRecognitionEngine,
    debug_dir: Path | None,
) -> PlayerOrderSlot:
    detected_color, color_confidence = detect_dominant_player_color(slot_images.indicator)
    raw_player_name, name_confidence = recognize_slot_name(
        slot_images.name,
        text_engine=text_engine,
        debug_dir=debug_dir,
        play_order=slot_profile.play_order,
    )
    return PlayerOrderSlot(
        play_order=slot_profile.play_order,
        expected_color=slot_profile.expected_color,
        detected_color=detected_color,
        raw_player_name=raw_player_name,
        color_confidence=color_confidence,
        name_confidence=name_confidence,
    )


def _slot_warnings(
    slot: PlayerOrderSlot,
    slot_profile: PlayerOrderSlotProfile,
) -> list[OcrWarning]:
    if (
        slot.detected_color == slot_profile.expected_color
        and slot.color_confidence >= MIN_COLOR_CONFIDENCE
    ):
        return []
    return [
        OcrWarning(
            code=WarningCode.PLAYER_ORDER_UNDETECTED,
            message=(
                f"Could not confidently detect {slot_profile.expected_color.value} "
                f"indicator for play order {slot_profile.play_order}."
            ),
            field_path=f"player_order[{slot_profile.play_order - 1}].detected_color",
        )
    ]


def _apply_column_slot(
    player: PlayerResultDraft,
    slot: PlayerOrderSlot | None,
) -> PlayerResultDraft:
    if slot is None:
        return player
    raw_player_name = player.raw_player_name
    if raw_player_name.value is None and slot.raw_player_name is not None:
        raw_player_name = OcrField(
            value=slot.raw_player_name,
            raw_text=slot.raw_player_name,
            confidence=slot.name_confidence,
        )
    return replace(
        player,
        raw_player_name=raw_player_name,
        play_order=OcrField(
            value=slot.play_order,
            raw_text=slot.expected_color.value,
            confidence=slot.color_confidence,
        ),
    )


def _apply_order_by_name(
    player: PlayerResultDraft,
    detection: PlayerOrderDetection,
) -> PlayerResultDraft:
    player_name = player.raw_player_name.value
    if player_name is None:
        return player
    matched_slot = find_matching_slot(player_name, detection.slots)
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
