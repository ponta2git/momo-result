from __future__ import annotations

from pathlib import Path

import pytest

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobHints, OcrJobMessage, PlayerAliasHint
from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message, to_stream_payload
from momo_ocr.shared.errors import OcrError


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


def test_invalid_request_id_is_dropped_on_parse() -> None:
    parsed = parse_job_message(
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
    assert parsed.request_id is None
