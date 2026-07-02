from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.ocr_domain.models import OcrWarning, WarningCode
from momo_ocr.features.parser_core.debug import NULL_DEBUG_SINK, DebugSink
from momo_ocr.features.player_order.color_detection import (
    MIN_COLOR_CONFIDENCE,
    detect_dominant_player_color,
)
from momo_ocr.features.player_order.models import PlayerOrderDetection, PlayerOrderSlot
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
    debug_sink: DebugSink = NULL_DEBUG_SINK,
) -> PlayerOrderDetection:
    image_size = Size(width=image.width, height=image.height)
    slots: list[PlayerOrderSlot] = []
    warnings: list[OcrWarning] = []

    for slot_profile in SLOT_PROFILES:
        slot_images = _crop_slot_images(image, image_size=image_size, slot_profile=slot_profile)
        _save_slot_debug_images(slot_images, slot_profile=slot_profile, debug_sink=debug_sink)
        slot = _detect_slot(
            slot_images,
            slot_profile=slot_profile,
            text_engine=text_engine,
            debug_sink=debug_sink,
        )
        warnings.extend(_slot_warnings(slot, slot_profile))
        slots.append(slot)

    confidences = [slot.color_confidence for slot in slots]
    return PlayerOrderDetection(
        slots=slots,
        confidence=min(confidences) if confidences else 0.0,
        warnings=warnings,
    )


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
    debug_sink: DebugSink,
) -> None:
    debug_sink.save_image(f"order_{slot_profile.play_order}_indicator.png", slot_images.indicator)
    debug_sink.save_image(f"order_{slot_profile.play_order}_name.png", slot_images.name)


def _detect_slot(
    slot_images: _SlotImages,
    *,
    slot_profile: PlayerOrderSlotProfile,
    text_engine: TextRecognitionEngine,
    debug_sink: DebugSink,
) -> PlayerOrderSlot:
    detected_color, color_confidence = detect_dominant_player_color(slot_images.indicator)
    raw_player_name, name_confidence = recognize_slot_name(
        slot_images.name,
        text_engine=text_engine,
        debug_sink=debug_sink,
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
