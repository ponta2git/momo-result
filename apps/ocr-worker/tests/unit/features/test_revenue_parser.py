from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.revenue.parser import RevenueParser
from momo_ocr.features.revenue.postprocess import parse_man_yen
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)


def test_parse_man_yen_handles_zero_yen_revenue() -> None:
    assert parse_man_yen("1億5800万円") == 15800
    assert parse_man_yen("1億5700万円 | NO11 社長 148570044") == 15700
    assert (
        parse_man_yen("オータカ社長 6300万円 | オータカ社長 8300万円 | オータカ社長 8300万円")
        == 8300
    )
    assert parse_man_yen("9100万円") == 9100
    assert parse_man_yen("0円") == 0


def test_revenue_parser_extracts_ranked_players_and_amounts(tmp_path: Path) -> None:
    image_path = tmp_path / "revenue.jpg"
    debug_dir = tmp_path / "debug"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        [
            "] 《 NO1 1社長 1億5800万円 | 6",
            "寺w4.11 ドー | & 148580059 | NO1 1 社長 1億5800万円",
            "GQ NO1 1社長 1億5800万円 |",
            "ぽんた社長 9100万円",
            "ぽんた社長 9100万円",
            "QR ぽんた社長 9100万円 |",
            "に Ad おたか社長 5000万円 回",
            "Ad おたか社長 5000万円",
            "ee おたか社長 5000万円 還",
            "A いーゆー社長 0円",
            "A いーゆー社長 0円",
            "A いーゆー社長 0円",
        ]
    )

    payload = RevenueParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=debug_dir,
            include_raw_text=True,
            text_engine=engine,
        )
    )

    assert payload.category_payload["status"] == "parsed"
    assert [player.rank.value for player in payload.players] == [1, 2, 3, 4]
    assert [player.raw_player_name.value for player in payload.players] == [
        "NO11社長",
        "ぽんた社長",
        "オータカ社長",
        "いーゆー社長",
    ]
    assert [player.revenue_man_yen.value for player in payload.players] == [
        15800,
        9100,
        5000,
        0,
    ]
    assert payload.raw_snippets is not None
    assert payload.raw_snippets["rank_4"] == "A いーゆー社長 0円"
    assert (debug_dir / "revenue" / "rank_1_row_prepared.png").exists()


def test_revenue_parser_warns_for_unreadable_row(tmp_path: Path) -> None:
    image_path = tmp_path / "revenue.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(["unknown"] * 36)

    payload = RevenueParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.REVENUE,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
        )
    )

    assert payload.players[0].raw_player_name.value is None
    assert payload.players[0].revenue_man_yen.value is None
    assert {warning.code.value for warning in payload.warnings} == {
        "MISSING_AMOUNT",
        "UNKNOWN_PLAYER_ALIAS",
    }


class SequenceTextRecognitionEngine(TextRecognitionEngine):
    def __init__(self, texts: Sequence[str]) -> None:
        self._texts = list(texts)

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm, config
        return RecognizedText(text=self._texts.pop(0), confidence=0.9)
