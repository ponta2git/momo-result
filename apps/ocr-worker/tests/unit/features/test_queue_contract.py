from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobHints, OcrJobMessage, PlayerAliasHint
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.shared.errors import OcrError

REPO_ROOT = Path(__file__).resolve().parents[5]
STREAM_PAYLOAD_SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "ocr-queue-payload-v1.schema.json"
OCR_HINTS_SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "ocr-hints-v1.schema.json"


def test_parse_job_message_uses_api_contract_keys() -> None:
    message = parse_job_message(
        {
            "jobId": "job-1",
            "draftId": "draft-1",
            "imageId": "image-1",
            "imagePath": "/tmp/sample.jpg",
            "requestedImageType": "total_assets",
            "attempt": "2",
            "enqueuedAt": "2026-04-29T10:00:00Z",
        }
    )

    assert message.job_id == "job-1"
    assert message.requested_screen_type == ScreenType.TOTAL_ASSETS
    assert message.attempt == 2
    assert message.hints == OcrJobHints()


def test_schema_validates_worker_serializer_with_hints_and_request_id() -> None:
    payload = _schema_valid_payload()

    message = parse_job_message(payload)

    assert message.job_id == "job-schema-1"
    assert message.draft_id == "draft-schema-1"
    assert message.image_id == "image-schema-1"
    assert message.image_path == Path("/tmp/momo-result/uploads/image-schema-1.png")
    assert message.requested_screen_type == ScreenType.INCIDENT_LOG
    assert message.attempt == 1
    assert message.enqueued_at == "2026-05-09T00:00:00Z"
    assert message.request_id == "req_20260509-abc"
    assert message.hints.game_title == "桃鉄2"
    assert message.hints.layout_family == "momotetsu_2"
    assert message.hints.known_player_aliases[0] == PlayerAliasHint(
        member_id="member-ponta",
        aliases=("ぽんた", "ぽんた社長"),
    )
    assert message.hints.known_player_aliases[1] == PlayerAliasHint(
        member_id="member-otaka",
        aliases=("オータカ", "オータカ社長"),
    )
    assert message.hints.computer_player_aliases == ("さくま", "さくま社長")
    assert to_stream_payload(message) == payload
    _assert_valid_stream_payload(payload)


def test_job_message_round_trips_to_api_payload_keys() -> None:
    payload = to_stream_payload(
        OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/sample.jpg"),
            requested_screen_type=ScreenType.REVENUE,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
            hints=OcrJobHints(),
        )
    )

    assert payload == {
        "jobId": "job-1",
        "draftId": "draft-1",
        "imageId": "image-1",
        "imagePath": "/tmp/sample.jpg",
        "requestedImageType": "revenue",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
    }
    _assert_valid_stream_payload(payload)
    assert parse_job_message(payload).requested_screen_type == ScreenType.REVENUE


def test_job_message_round_trips_api_ocr_hints() -> None:
    payload = to_stream_payload(
        OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/sample.jpg"),
            requested_screen_type=ScreenType.INCIDENT_LOG,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
            hints=OcrJobHints(
                game_title="桃鉄2",
                layout_family="momotetsu_2",
                known_player_aliases=(
                    PlayerAliasHint(member_id="member-ponta", aliases=("ぽんた", "ぽんた社長")),
                    PlayerAliasHint(member_id="member-otaka", aliases=("オータカ", "オータカ社長")),
                ),
                computer_player_aliases=("さくま", "さくま社長"),
            ),
        )
    )

    assert payload["ocrHintsJson"] == (
        '{"computerPlayerAliases":["さくま","さくま社長"],'
        '"gameTitle":"桃鉄2",'
        '"knownPlayerAliases":['
        '{"aliases":["ぽんた","ぽんた社長"],"memberId":"member-ponta"},'
        '{"aliases":["オータカ","オータカ社長"],"memberId":"member-otaka"}'
        "],"
        '"layoutFamily":"momotetsu_2"}'
    )
    _assert_valid_stream_payload(payload)
    parsed = parse_job_message(payload)
    assert parsed.hints.game_title == "桃鉄2"
    assert parsed.hints.layout_family == "momotetsu_2"
    assert parsed.hints.known_player_aliases[0].member_id == "member-ponta"
    assert parsed.hints.known_player_aliases[0].aliases == ("ぽんた", "ぽんた社長")
    assert parsed.hints.computer_player_aliases == ("さくま", "さくま社長")


def test_parse_job_message_rejects_missing_required_keys() -> None:
    with pytest.raises(OcrError) as error:
        parse_job_message({"jobId": "job-1"})

    assert error.value.code.value == "QUEUE_FAILURE"
    assert "draftId" in error.value.message


def test_parse_job_message_rejects_schema_invalid_top_level_payloads() -> None:
    payload = _schema_valid_payload()

    invalid_payloads: list[tuple[Mapping[str, object], tuple[str, ...]]] = [
        ({**payload, "attempt": 1}, ("$.attempt", "not of type 'string'")),
        ({**payload, "unknownField": "value"}, ("Additional properties", "unknownField")),
        ({**payload, "jobId": ""}, ("$.jobId", "should be non-empty")),
        ({**payload, "imagePath": "relative/image.png"}, ("$.imagePath", "does not match '^/'")),
        ({**payload, "attempt": "01"}, ("$.attempt", "does not match")),
        ({**payload, "enqueuedAt": "not-a-date-time"}, ("$.enqueuedAt", "not-a-date-time")),
    ]

    for invalid_payload, expected_messages in invalid_payloads:
        with pytest.raises(OcrError) as error:
            parse_job_message(invalid_payload)

        assert error.value.code.value == "QUEUE_FAILURE"
        for expected_message in expected_messages:
            assert expected_message in error.value.message


def test_parse_job_message_rejects_invalid_hint_json() -> None:
    payload = {
        "jobId": "job-1",
        "draftId": "draft-1",
        "imageId": "image-1",
        "imagePath": "/tmp/sample.jpg",
        "requestedImageType": "total_assets",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
        "ocrHintsJson": "{invalid",
    }

    with pytest.raises(OcrError) as error:
        parse_job_message(payload)

    assert error.value.code.value == "QUEUE_FAILURE"
    assert "valid JSON" in error.value.message


def test_parse_job_message_rejects_invalid_alias_hint_shape() -> None:
    payload = {
        "jobId": "job-1",
        "draftId": "draft-1",
        "imageId": "image-1",
        "imagePath": "/tmp/sample.jpg",
        "requestedImageType": "total_assets",
        "attempt": "1",
        "enqueuedAt": "2026-04-29T10:00:00Z",
        "ocrHintsJson": '{"knownPlayerAliases":[{"memberId":"member-1","aliases":"ぽんた"}]}',
    }

    with pytest.raises(OcrError) as error:
        parse_job_message(payload)

    assert error.value.code.value == "QUEUE_FAILURE"
    assert "knownPlayerAliases[0].aliases" in error.value.message


def test_parse_job_message_rejects_schema_invalid_hint_payloads() -> None:
    payload = _schema_valid_payload()
    invalid_hints = [
        ('{"unknownField":"value"}', ("Additional properties", "unknownField")),
        (
            '{"knownPlayerAliases":[{"memberId":"member-1"}]}',
            ("$.knownPlayerAliases[0]", "aliases"),
        ),
        (
            '{"knownPlayerAliases":[{"memberId":"member-1","aliases":[],"extra":"value"}]}',
            ("$.knownPlayerAliases[0]", "Additional properties", "extra"),
        ),
    ]

    for raw_hints, expected_messages in invalid_hints:
        with pytest.raises(OcrError) as error:
            parse_job_message({**payload, "ocrHintsJson": raw_hints})

        assert error.value.code.value == "QUEUE_FAILURE"
        for expected_message in expected_messages:
            assert expected_message in error.value.message


def test_request_id_round_trips_when_set() -> None:
    payload = to_stream_payload(
        OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/sample.jpg"),
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
            hints=OcrJobHints(),
            request_id="abc-123_DEF",
        )
    )
    assert payload["requestId"] == "abc-123_DEF"
    _assert_valid_stream_payload(payload)
    assert parse_job_message(payload).request_id == "abc-123_DEF"


def test_request_id_is_omitted_when_absent() -> None:
    payload = to_stream_payload(
        OcrJobMessage(
            job_id="job-1",
            draft_id="draft-1",
            image_id="image-1",
            image_path=Path("/tmp/sample.jpg"),
            requested_screen_type=ScreenType.TOTAL_ASSETS,
            attempt=1,
            enqueued_at="2026-04-29T10:00:00Z",
            hints=OcrJobHints(),
        )
    )
    assert "requestId" not in payload
    assert parse_job_message(payload).request_id is None


def test_invalid_request_id_is_rejected_by_runtime_schema_validation() -> None:
    with pytest.raises(OcrError) as error:
        parse_job_message(
            {
                "jobId": "job-1",
                "draftId": "draft-1",
                "imageId": "image-1",
                "imagePath": "/tmp/sample.jpg",
                "requestedImageType": "total_assets",
                "attempt": "1",
                "enqueuedAt": "2026-04-29T10:00:00Z",
                "requestId": "bad value with spaces",
            }
        )

    assert error.value.code.value == "QUEUE_FAILURE"
    assert "$.requestId" in error.value.message


def test_stream_payload_schema_rejects_non_string_and_unknown_fields() -> None:
    payload = _schema_valid_payload()

    with pytest.raises(ValidationError):
        _stream_payload_validator().validate({**payload, "attempt": 1})

    with pytest.raises(ValidationError):
        _stream_payload_validator().validate({**payload, "unknownField": "value"})

    with pytest.raises(ValidationError):
        _stream_payload_validator().validate({**payload, "enqueuedAt": "not-a-date-time"})


def _schema_valid_payload() -> dict[str, str]:
    return to_stream_payload(
        OcrJobMessage(
            job_id="job-schema-1",
            draft_id="draft-schema-1",
            image_id="image-schema-1",
            image_path=Path("/tmp/momo-result/uploads/image-schema-1.png"),
            requested_screen_type=ScreenType.INCIDENT_LOG,
            attempt=1,
            enqueued_at="2026-05-09T00:00:00Z",
            hints=OcrJobHints(
                game_title="桃鉄2",
                layout_family="momotetsu_2",
                known_player_aliases=(
                    PlayerAliasHint(member_id="member-ponta", aliases=("ぽんた", "ぽんた社長")),
                    PlayerAliasHint(member_id="member-otaka", aliases=("オータカ", "オータカ社長")),
                ),
                computer_player_aliases=("さくま", "さくま社長"),
            ),
            request_id="req_20260509-abc",
        )
    )


def _assert_valid_stream_payload(payload: dict[str, str]) -> None:
    _stream_payload_validator().validate(payload)
    raw_hints = payload.get("ocrHintsJson")
    if raw_hints:
        _ocr_hints_validator().validate(_load_json_object(raw_hints))


def _stream_payload_validator() -> Draft202012Validator:
    return _validator_for(STREAM_PAYLOAD_SCHEMA_PATH)


def _ocr_hints_validator() -> Draft202012Validator:
    return _validator_for(OCR_HINTS_SCHEMA_PATH)


def _validator_for(schema_path: Path) -> Draft202012Validator:
    schema = _load_json_file_object(schema_path)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def _load_json_file_object(path: Path) -> dict[str, object]:
    return _load_json_object(path.read_text(encoding="utf-8"))


def _load_json_object(raw_json: str) -> dict[str, object]:
    raw = json.loads(raw_json)
    if not isinstance(raw, dict):
        msg = "JSON Schema contract data must be a JSON object"
        raise TypeError(msg)
    return cast("dict[str, object]", raw)
