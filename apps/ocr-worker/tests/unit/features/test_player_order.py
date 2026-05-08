from __future__ import annotations

from PIL import Image, ImageDraw

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.ocr_domain.models import OcrField, PlayerResultDraft
from momo_ocr.features.player_order.detector import (
    apply_player_order_to_column_players,
    apply_player_order_to_ranked_players,
    detect_player_order,
)
from momo_ocr.features.player_order.models import PlayerColor, PlayerOrderDetection, PlayerOrderSlot
from momo_ocr.features.player_order.profile import SLOT_PROFILES
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)


def test_detect_player_order_reads_four_color_slots_and_names() -> None:
    image = Image.new("RGB", (1920, 1080), "black")
    draw = ImageDraw.Draw(image)
    colors = ["#2878d0", "#d03030", "#d8a020", "#60a020"]
    size = Size(width=image.width, height=image.height)
    for slot_profile, color in zip(SLOT_PROFILES, colors, strict=True):
        rect = scale_profile_rect_to_image(slot_profile.indicator_roi, size)
        draw.rectangle((rect.x, rect.y, rect.x + rect.width, rect.y + rect.height), fill=color)
    engine = SlotTextRecognitionEngine(["いーゆ社長", "おーたか社長", "ぽんた社長", "NO1 1社長"])

    detection = detect_player_order(image, text_engine=engine)

    assert [slot.detected_color for slot in detection.slots] == [
        PlayerColor.BLUE,
        PlayerColor.RED,
        PlayerColor.YELLOW,
        PlayerColor.GREEN,
    ]
    assert [slot.raw_player_name for slot in detection.slots] == [
        "いーゆ社長",
        "おーたか社長",
        "ぽんた社長",
        "NO1 1社長",
    ]
    assert detection.confidence > 0.9
    assert detection.warnings == []


def test_apply_player_order_matches_ranked_player_names() -> None:
    detection = _sample_detection()
    players = [
        PlayerResultDraft(raw_player_name=OcrField(value="NO1 1 社長")),
        PlayerResultDraft(raw_player_name=OcrField(value="おーたか社長")),
        PlayerResultDraft(raw_player_name=OcrField(value="ぽんた社長")),
        PlayerResultDraft(raw_player_name=OcrField(value="ゆー社長")),
    ]

    updated = apply_player_order_to_ranked_players(players, detection)

    assert [player.play_order.value for player in updated] == [4, 2, 3, 1]


def test_apply_player_order_matches_known_ocr_mixed_kana_noise() -> None:
    detection = PlayerOrderDetection(
        slots=[
            PlayerOrderSlot(
                play_order=3,
                expected_color=PlayerColor.YELLOW,
                detected_color=PlayerColor.YELLOW,
                raw_player_name="いローゆー社長",
                color_confidence=0.9,
                name_confidence=0.8,
            )
        ],
        confidence=0.9,
    )
    players = [PlayerResultDraft(raw_player_name=OcrField(value="いーゆー社長"))]

    updated = apply_player_order_to_ranked_players(players, detection)

    assert updated[0].play_order.value == 3


def test_apply_player_order_matches_ranked_name_missing_leading_i() -> None:
    detection = PlayerOrderDetection(
        slots=[
            PlayerOrderSlot(
                play_order=3,
                expected_color=PlayerColor.YELLOW,
                detected_color=PlayerColor.YELLOW,
                raw_player_name="いーゆー社長",
                color_confidence=0.9,
                name_confidence=0.8,
            )
        ],
        confidence=0.9,
    )
    players = [PlayerResultDraft(raw_player_name=OcrField(value="ハーゆー社長"))]

    updated = apply_player_order_to_ranked_players(players, detection)

    assert updated[0].play_order.value == 3


def test_apply_player_order_assigns_column_players_by_slot() -> None:
    detection = _sample_detection()
    players = [PlayerResultDraft() for _ in range(4)]

    updated = apply_player_order_to_column_players(players, detection)

    assert [player.play_order.value for player in updated] == [1, 2, 3, 4]
    assert [player.raw_player_name.value for player in updated] == [
        "いーゆ社長",
        "おーたか社長",
        "ぽんた社長",
        "NO1 1社長",
    ]


def _sample_detection() -> PlayerOrderDetection:
    names = ["いーゆ社長", "おーたか社長", "ぽんた社長", "NO1 1社長"]
    colors = [PlayerColor.BLUE, PlayerColor.RED, PlayerColor.YELLOW, PlayerColor.GREEN]
    return PlayerOrderDetection(
        slots=[
            PlayerOrderSlot(
                play_order=index + 1,
                expected_color=color,
                detected_color=color,
                raw_player_name=name,
                color_confidence=0.95,
                name_confidence=0.9,
            )
            for index, (color, name) in enumerate(zip(colors, names, strict=True))
        ],
        confidence=0.95,
    )


class SequenceTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, texts: list[str]) -> None:
        self._texts = texts

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm, config
        text = self._texts[0]
        self._texts = self._texts[1:]
        return RecognizedText(text=text, confidence=0.9)


class SlotTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, texts: list[str]) -> None:
        self._texts = texts
        self._calls = 0

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm, config
        slot_index = min(self._calls // 8, len(self._texts) - 1)
        self._calls += 1
        return RecognizedText(text=self._texts[slot_index], confidence=0.9)
