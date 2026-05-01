from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobHints, OcrJobMessage, PlayerAliasHint
from momo_ocr.shared.errors import FailureCode, OcrError

REQUIRED_STREAM_PAYLOAD_KEYS = {
    "jobId",
    "draftId",
    "imageId",
    "imagePath",
    "requestedImageType",
    "attempt",
    "enqueuedAt",
}
OCR_HINTS_KEY = "ocrHintsJson"
REQUEST_ID_KEY = "requestId"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def parse_job_message(payload: Mapping[str, str]) -> OcrJobMessage:
    missing_keys = REQUIRED_STREAM_PAYLOAD_KEYS - payload.keys()
    if missing_keys:
        missing = ", ".join(sorted(missing_keys))
        raise OcrError(FailureCode.QUEUE_FAILURE, f"OCR queue message is missing keys: {missing}")

    try:
        requested_screen_type = ScreenType(payload["requestedImageType"])
    except ValueError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            f"Unsupported requestedImageType in OCR queue message: {payload['requestedImageType']}",
        ) from exc

    try:
        attempt = int(payload["attempt"])
    except ValueError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            "OCR queue message attempt must be an integer.",
        ) from exc

    if attempt < 1:
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue message attempt must be positive.")

    return OcrJobMessage(
        job_id=payload["jobId"],
        draft_id=payload["draftId"],
        image_id=payload["imageId"],
        image_path=Path(payload["imagePath"]),
        requested_screen_type=requested_screen_type,
        attempt=attempt,
        enqueued_at=payload["enqueuedAt"],
        hints=_parse_hints(payload.get(OCR_HINTS_KEY)),
        request_id=_parse_request_id(payload.get(REQUEST_ID_KEY)),
    )


def to_stream_payload(message: OcrJobMessage) -> dict[str, str]:
    payload = {
        "jobId": message.job_id,
        "draftId": message.draft_id,
        "imageId": message.image_id,
        "imagePath": str(message.image_path),
        "requestedImageType": message.requested_screen_type.value,
        "attempt": str(message.attempt),
        "enqueuedAt": message.enqueued_at,
    }
    hints_payload = _hints_to_payload(message.hints)
    if hints_payload:
        payload[OCR_HINTS_KEY] = json.dumps(
            hints_payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    if message.request_id and REQUEST_ID_PATTERN.match(message.request_id):
        payload[REQUEST_ID_KEY] = message.request_id
    return payload


def _parse_request_id(raw: str | None) -> str | None:
    if raw is None or raw == "":
        return None
    if not REQUEST_ID_PATTERN.match(raw):
        # Drop malformed values rather than fail the job; the API generates
        # safe ids itself, so this only protects against tampering.
        return None
    return raw


def _parse_hints(raw_hints: str | None) -> OcrJobHints:
    if raw_hints is None or raw_hints == "":
        return OcrJobHints()
    try:
        parsed: object = json.loads(raw_hints)
    except json.JSONDecodeError as exc:
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue hints must be valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue hints must be a JSON object.")
    parsed_payload = cast("Mapping[str, object]", parsed)
    return OcrJobHints(
        game_title=_optional_string(parsed_payload, "gameTitle"),
        layout_family=_optional_string(parsed_payload, "layoutFamily"),
        known_player_aliases=_parse_known_player_aliases(parsed_payload.get("knownPlayerAliases")),
        computer_player_aliases=_parse_string_tuple(
            parsed_payload.get("computerPlayerAliases"),
            field_name="computerPlayerAliases",
        ),
    )


def _optional_string(payload: Mapping[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise OcrError(FailureCode.QUEUE_FAILURE, f"OCR queue hint {key} must be a string.")
    return value


def _parse_known_player_aliases(value: object) -> tuple[PlayerAliasHint, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            "OCR queue hint knownPlayerAliases must be a JSON array.",
        )

    hints: list[PlayerAliasHint] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise OcrError(
                FailureCode.QUEUE_FAILURE,
                f"OCR queue hint knownPlayerAliases[{index}] must be an object.",
            )
        item_payload = cast("Mapping[str, object]", item)
        member_id = item_payload.get("memberId")
        if not isinstance(member_id, str) or member_id == "":
            raise OcrError(
                FailureCode.QUEUE_FAILURE,
                f"OCR queue hint knownPlayerAliases[{index}].memberId must be a non-empty string.",
            )
        hints.append(
            PlayerAliasHint(
                member_id=member_id,
                aliases=_parse_string_tuple(
                    item_payload.get("aliases"),
                    field_name=f"knownPlayerAliases[{index}].aliases",
                ),
            )
        )
    return tuple(hints)


def _parse_string_tuple(value: object, *, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise OcrError(
            FailureCode.QUEUE_FAILURE, f"OCR queue hint {field_name} must be a string array."
        )
    items: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise OcrError(
                FailureCode.QUEUE_FAILURE,
                f"OCR queue hint {field_name} must be a string array.",
            )
        items.append(item)
    return tuple(items)


def _hints_to_payload(hints: OcrJobHints) -> dict[str, object]:
    payload: dict[str, object] = {}
    if hints.game_title is not None:
        payload["gameTitle"] = hints.game_title
    if hints.layout_family is not None:
        payload["layoutFamily"] = hints.layout_family
    if hints.known_player_aliases:
        payload["knownPlayerAliases"] = [
            {"memberId": alias.member_id, "aliases": list(alias.aliases)}
            for alias in hints.known_player_aliases
        ]
    if hints.computer_player_aliases:
        payload["computerPlayerAliases"] = list(hints.computer_player_aliases)
    return payload
