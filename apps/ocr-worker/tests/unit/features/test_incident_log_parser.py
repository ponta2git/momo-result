from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from PIL import Image

from momo_ocr.features.incident_log.parser import IncidentLogParser
from momo_ocr.features.incident_log.postprocess import is_pure_pipe_noise, parse_count
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)

PRIMARY_RECOGNITIONS_PER_CELL = 2
RECOGNITIONS_PER_CELL_WITH_FALLBACK = 6
INCIDENT_CELL_COUNT = 24


def test_parse_count_handles_common_ocr_aliases() -> None:
    assert parse_count("0") == 0
    assert parse_count("O") == 0
    assert parse_count("i") == 1
    assert parse_count("|") == 1
    assert parse_count("3 | 5") == 5
    assert parse_count("i | 0") == 0
    assert parse_count("12 | 12") == 12


def test_parse_count_treats_leading_zero_multidigit_as_zero() -> None:
    # 罫線ノイズで "0" の後ろに余計な数字が連結されたケースは 0 と解釈する。
    assert parse_count("01") == 0
    assert parse_count("03") == 0
    assert parse_count("O71") == 0
    # 先頭が 0 でなければそのまま (10, 12 などの正常値は維持)。
    assert parse_count("10") == 10
    assert parse_count("12") == 12


def test_is_pure_pipe_noise_detects_vertical_bar_only_strings() -> None:
    assert is_pure_pipe_noise("|")
    assert is_pure_pipe_noise("| | i")
    assert is_pure_pipe_noise("ll")
    assert not is_pure_pipe_noise("1")
    assert not is_pure_pipe_noise("5|")
    assert not is_pure_pipe_noise("")


def test_incident_log_parser_extracts_fixed_incident_counts(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    debug_dir = tmp_path / "debug"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    counts_by_incident = [
        [0, 0, 0, 1],
        [5, 5, 7, 5],
        [0, 0, 0, 0],
        [2, 2, 2, 3],
        [0, 2, 0, 0],
        [0, 0, 0, 0],
    ]
    engine = SequenceTextRecognitionEngine(_all_recognition_texts_for_counts(counts_by_incident))

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=debug_dir,
            include_raw_text=True,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.category_payload["status"] == "parsed"
    assert payload.category_payload["layout_profile_id"] == "full-hd-incident-log-v1"
    assert len(payload.players) == 4
    assert payload.players[0].incidents["目的地"].value == 0
    assert payload.players[3].incidents["目的地"].value == 1
    assert payload.players[2].incidents["プラス駅"].value == 7
    assert payload.players[3].incidents["カード駅"].value == 3
    assert payload.players[1].incidents["カード売り場"].value == 2
    assert payload.raw_snippets is not None
    assert payload.raw_snippets["目的地_player_4"] == "1"
    assert (debug_dir / "incident_log" / "目的地_player_1_cell_prepared.png").exists()


def test_incident_log_parser_warns_for_unreadable_count(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        [""] * INCIDENT_CELL_COUNT * RECOGNITIONS_PER_CELL_WITH_FALLBACK
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.players[0].incidents["目的地"].value is None
    assert {warning.code.value for warning in payload.warnings} == {"MISSING_INCIDENT_COUNT"}


def test_incident_log_parser_uses_compact_layout_hint(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        ["0"] * INCIDENT_CELL_COUNT * RECOGNITIONS_PER_CELL_WITH_FALLBACK
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            layout_family_hint="momotetsu_2",
        )
    )

    assert payload.category_payload["layout_profile_id"] == "full-hd-incident-log-compact-v1"


def test_incident_log_parser_auto_selects_profile_with_fewer_missing_counts(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        ([""] * INCIDENT_CELL_COUNT * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
        + (["0"] * INCIDENT_CELL_COUNT * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
        )
    )

    assert payload.category_payload["layout_profile_id"] == "full-hd-incident-log-compact-v1"
    assert {warning.code.value for warning in payload.warnings} == set()


def test_incident_log_parser_fallback_preprocessing_repairs_suspicious_digit_noise(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        ["23", "23", "2", "2", "20", "20"]
        + (["0"] * (INCIDENT_CELL_COUNT - 1) * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=True,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.players[0].incidents["目的地"].value == 2
    assert payload.raw_snippets is not None
    assert payload.raw_snippets["目的地_player_1"] == "23 | 2 | 20"


def test_incident_log_parser_majority_vote_overrides_primary_misread(
    tmp_path: Path,
) -> None:
    # Primary が "lo" (=10) と誤読し、fallback の 3 候補が "0" を返した場合、
    # 多数決により count=0 を採用すること。Bug "0→10" の回帰防止。
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    engine = SequenceTextRecognitionEngine(
        ["lo", "lo", "0", "0", "0", "0"]
        + (["0"] * (INCIDENT_CELL_COUNT - 1) * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.players[0].incidents["目的地"].value == 0
    confidence = payload.players[0].incidents["目的地"].confidence
    assert confidence is not None
    assert confidence > 0


def test_incident_log_parser_uses_stricter_ginji_cell_fallback(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    # First 20 non-Ginji cells are zero, then first Ginji cell has primary 3 and fallback 0.
    engine = SequenceTextRecognitionEngine(
        (["0"] * 20 * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
        + ["3", "3", "0", "0", "6", "6"]
        + (["0"] * 3 * RECOGNITIONS_PER_CELL_WITH_FALLBACK)
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=True,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.players[0].incidents["スリの銀次"].value == 0


def test_incident_log_parser_warns_for_domain_implausible_counts(tmp_path: Path) -> None:
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    counts_by_incident = [
        [4, 0, 0, 0],
        [4, 0, 0, 0],
        [4, 0, 0, 0],
        [4, 0, 0, 0],
        [0, 0, 0, 0],
        [2, 1, 0, 0],
    ]
    engine = SequenceTextRecognitionEngine(_all_recognition_texts_for_counts(counts_by_incident))

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    warning_codes = [warning.code.value for warning in payload.warnings]
    assert warning_codes == ["SUSPICIOUS_INCIDENT_COUNT", "SUSPICIOUS_INCIDENT_COUNT"]


def _all_recognition_texts_for_counts(counts_by_incident: list[list[int]]) -> list[str]:
    return [
        str(count)
        for incident_counts in counts_by_incident
        for count in incident_counts
        for _ in range(RECOGNITIONS_PER_CELL_WITH_FALLBACK)
    ]


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


class SequenceTextRecognitionEngineWithConfidence(TextRecognitionEngine):
    """各認識ごとに (text, confidence) を返すモック。"""

    def __init__(self, items: Sequence[tuple[str, float]]) -> None:
        self._items = list(items)

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        del image, field, psm, config
        text, confidence = self._items.pop(0)
        return RecognizedText(text=text, confidence=confidence)


def test_incident_log_parser_prefers_digit_text_over_zero_alias_noise(
    tmp_path: Path,
) -> None:
    # Tesseract が PSM 10/13 で短い digit を読むと confidence=0.0 を返す既知の
    # quirk がある (例: 1 桁の "3"). この場合、装飾シャドウを letter "Oo"/"oo" と
    # 誤読した低 conf 票が複数あると、conf 合計や votes だけでは正解 ("3") が
    # ノイズに負けてしまう。
    # has_digit ゲートにより「テキストに literal digit が含まれているか」を最優先
    # することで、conf=0 でも digit 票を勝たせる。
    image_path = tmp_path / "incident.jpg"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")
    # 1 セル目 (player_1 / 目的地): primary 2 PSM = "3" conf 0.0,
    # fallback variants (sharpened, otsu) = "3"/"oo"/...
    # 合計 6 認識のうち 4 認識が "3" (digit), 2 認識が letter alias 由来の "0"。
    # 旧 sum_conf 優先実装では count=0 が勝ってしまう (sum=0.14 vs 0.0)。
    # has_digit 優先実装では "3" 4 票 (has_digit=True) が勝つ。
    cell_one = [
        ("3", 0.0),
        ("3", 0.0),
        ("3", 0.0),
        ("3", 0.0),
        ("oo", 0.07),
        ("oo", 0.07),
    ]
    rest = [("0", 0.9)] * (INCIDENT_CELL_COUNT - 1) * RECOGNITIONS_PER_CELL_WITH_FALLBACK
    engine = SequenceTextRecognitionEngineWithConfidence(cell_one + rest)

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.INCIDENT_LOG,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            layout_family_hint="world",
        )
    )

    assert payload.players[0].incidents["目的地"].value == 3
