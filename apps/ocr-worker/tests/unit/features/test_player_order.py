from __future__ import annotations

from PIL import Image, ImageDraw

from momo_ocr.features.ocr_domain.models import OcrField, PlayerResultDraft
from momo_ocr.features.player_order.detector import (
    apply_player_order_to_column_players,
    apply_player_order_to_ranked_players,
    detect_player_order,
)
from momo_ocr.features.player_order.models import PlayerColor, PlayerOrderDetection, PlayerOrderSlot
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)


def test_detect_player_order_reads_four_color_slots_and_names() -> None:
    image = Image.new("RGB", (1280, 720), "black")
    draw = ImageDraw.Draw(image)
    colors = ["#2878d0", "#d03030", "#d8a020", "#60a020"]
    for index, color in enumerate(colors):
        draw.rectangle((index * 320, 620, (index + 1) * 320, 720), fill=color)
    engine = SequenceTextRecognitionEngine(
        [
            "いーゆ社長",
            "いーゆ社長",
            "おーたか社長",
            "おーたか社長",
            "ぽんた社長",
            "ぽんた社長",
            "NO1 1社長",
            "NO1 1社長",
        ]
    )

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
