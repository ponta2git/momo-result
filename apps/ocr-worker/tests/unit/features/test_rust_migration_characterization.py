from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict, cast

from PIL import Image

from momo_ocr.features.image_processing.geometry import Rect, Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.preprocessing import otsu_binarize
from momo_ocr.features.incident_log.attempts import CountRecognitionResult, PsmAttempt
from momo_ocr.features.incident_log.postprocess import parse_count
from momo_ocr.features.incident_log.voting import select_count_recognition, vote_count
from momo_ocr.features.ocr_domain.money import parse_man_yen
from momo_ocr.features.revenue.postprocess import parse_man_yen as parse_revenue_man_yen

REPO_ROOT = Path(__file__).resolve().parents[5]
FIXTURE_PATH = (
    REPO_ROOT / "docs" / "schemas" / "fixtures" / "ocr-worker" / "core-characterization-v1.json"
)


class _Attempt(TypedDict):
    text: str
    count: int | None
    confidence: float | None


def _fixture() -> dict[str, object]:
    return cast("dict[str, object]", json.loads(FIXTURE_PATH.read_text(encoding="utf-8")))


def test_shared_geometry_and_otsu_characterization_is_locked_before_rust_port() -> None:
    fixture = _fixture()
    for raw_case in cast("list[dict[str, object]]", fixture["geometryCases"]):
        profile = cast("dict[str, int]", raw_case["profileRect"])
        image_size = cast("dict[str, int]", raw_case["imageSize"])
        expected = cast("dict[str, int]", raw_case["expected"])
        geometry_actual = scale_profile_rect_to_image(Rect(**profile), Size(**image_size))
        assert geometry_actual == Rect(**expected), raw_case["name"]

    for raw_case in cast("list[dict[str, object]]", fixture["otsuCases"]):
        width = cast("int", raw_case["width"])
        height = cast("int", raw_case["height"])
        pixels = cast("list[int]", raw_case["pixels"])
        source = Image.new("L", (width, height))
        source.putdata(pixels)
        otsu_actual = list(otsu_binarize(source).get_flattened_data())
        assert otsu_actual == raw_case["expected"], raw_case["name"]


def test_shared_domain_parser_characterization_is_locked_before_rust_port() -> None:
    fixture = _fixture()
    for raw_case in cast("list[dict[str, object]]", fixture["moneyCases"]):
        parser = parse_revenue_man_yen if raw_case["revenue"] else parse_man_yen
        assert parser(cast("str", raw_case["input"])) == raw_case["expected"]
    for raw_case in cast("list[dict[str, object]]", fixture["countCases"]):
        assert parse_count(cast("str", raw_case["input"])) == raw_case["expected"]


def test_shared_incident_voting_characterization_is_locked_before_rust_port() -> None:
    fixture = _fixture()
    for raw_case in cast("list[dict[str, object]]", fixture["voteCases"]):
        attempts = [_psm_attempt(item) for item in cast("list[_Attempt]", raw_case["attempts"])]
        vote_actual = vote_count(attempts)
        assert vote_actual == (
            raw_case["expectedCount"],
            raw_case["expectedConfidence"],
        ), raw_case["name"]

    for raw_case in cast("list[dict[str, object]]", fixture["selectionCases"]):
        primary = _recognition(cast("_Attempt", raw_case["primary"]))
        fallbacks = [_recognition(item) for item in cast("list[_Attempt]", raw_case["fallbacks"])]
        selection_actual = select_count_recognition(
            primary,
            fallbacks,
            max_plausible_count=cast("int", raw_case["maximumPlausibleCount"]),
        )
        assert selection_actual.count == raw_case["expectedCount"], raw_case["name"]


def _psm_attempt(value: _Attempt) -> PsmAttempt:
    return PsmAttempt(
        text=value["text"],
        count=value["count"],
        confidence=value["confidence"],
    )


def _recognition(value: _Attempt) -> CountRecognitionResult:
    return CountRecognitionResult(
        raw_text=value["text"],
        count=value["count"],
        confidence=value["confidence"],
    )
