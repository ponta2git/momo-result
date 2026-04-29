from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from PIL import Image

from momo_ocr.features.incident_log.parser import IncidentLogParser
from momo_ocr.features.incident_log.postprocess import parse_count
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)


def test_parse_count_handles_common_ocr_aliases() -> None:
    assert parse_count("0") == 0
    assert parse_count("O") == 0
    assert parse_count("i") == 1
    assert parse_count("|") == 1
    assert parse_count("3 | 5") == 5
    assert parse_count("i | 0") == 0
    assert parse_count("12 | 12") == 12


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
    engine = SequenceTextRecognitionEngine(
        [
            str(count)
            for incident_counts in counts_by_incident
            for count in incident_counts
            for _ in range(2)
        ]
    )

    payload = IncidentLogParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.INCIDENT_LOG,
            profile_id="full-hd-incident-log-v1",
            debug_dir=debug_dir,
            include_raw_text=True,
            text_engine=engine,
        )
    )

    assert payload.category_payload["status"] == "parsed"
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
    engine = SequenceTextRecognitionEngine([""] * 48)

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

    assert payload.players[0].incidents["目的地"].value is None
    assert {warning.code.value for warning in payload.warnings} == {"MISSING_INCIDENT_COUNT"}


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
