from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.ocr_results.ranked_rows import extract_player_name_candidate
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)
from momo_ocr.features.total_assets.parser import TotalAssetsParser
from momo_ocr.features.total_assets.postprocess import parse_man_yen


def test_parse_man_yen_handles_oku_and_man_units() -> None:
    assert parse_man_yen("3億8480万円 | 7") == 38480
    assert parse_man_yen("3信8920万円") == 38920
    assert parse_man_yen("2億円") == 20000
    assert parse_man_yen("2借3100万円") == 23100
    assert parse_man_yen("オータカ社長 214105 ie | オータカ社長 test 11 0万円") == 21410
    assert parse_man_yen("2190万口") == 2190
    assert parse_man_yen("-120万円") == -120
    assert parse_man_yen("10547059") == 105470
    assert parse_man_yen("21105") == 2110


def test_extract_player_name_candidate_normalizes_known_aliases() -> None:
    assert (
        extract_player_name_candidate("なーーールーな Se se SE NO11 社長 148570044") == "NO11社長"
    )
    assert (
        extract_player_name_candidate("アト さパ ロン オータカ社長 3億3560万円") == "オータカ社長"
    )
    assert extract_player_name_candidate("トニ ぼんた社長 2183820hFH") == "ぽんた社長"


def test_total_assets_parser_extracts_ranked_players_and_amounts(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    debug_dir = tmp_path / "debug"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        [
            "| 《 NO1 1 社長 3億8480万円 | 7",
            "| 《 NO1 1 社長 3億8480万円 | 7",
            "| 《 NO1 1 社長 3億8480万円 | 7",
            "\\ Wee) | O® おーたか社長 3億6080万円 年",
            "\\ Wee) | O® おーたか社長 3億6080万円 年",
            "\\ Wee) | O® おーたか社長 3億6080万円 年",
            "OW ぽんた社長 2億4460万円",
            "OW ぽんた社長 2億4460万円",
            "OW ぽんた社長 2億4460万円",
            "| Guy ei VQ ... 2190万円 |",
            "| Ad いーゆー社長 2190万円 |",
            "| Guy ei VQ ... 2190万円 |",
        ]
    )

    payload = TotalAssetsParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.TOTAL_ASSETS,
            profile_id="full-hd-total-assets-v1",
            debug_dir=debug_dir,
            include_raw_text=True,
            text_engine=engine,
        )
    )

    assert payload.category_payload["status"] == "parsed"
    assert [player.rank.value for player in payload.players] == [1, 2, 3, 4]
    assert [player.raw_player_name.value for player in payload.players] == [
        "NO11社長",
        "オータカ社長",
        "ぽんた社長",
        "いーゆー社長",
    ]
    assert [player.total_assets_man_yen.value for player in payload.players] == [
        38480,
        36080,
        24460,
        2190,
    ]
    assert payload.raw_snippets is not None
    assert payload.raw_snippets["rank_1"] == "| 《 NO1 1 社長 3億8480万円 | 7"
    assert (debug_dir / "total_assets" / "rank_1_row_prepared.png").exists()


def test_total_assets_parser_warns_for_unreadable_row(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(["unknown"] * 36)

    payload = TotalAssetsParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            detected_screen_type=ScreenType.TOTAL_ASSETS,
            profile_id="full-hd-total-assets-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
        )
    )

    assert payload.players[0].raw_player_name.value is None
    assert payload.players[0].total_assets_man_yen.value is None
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
