from __future__ import annotations

import json
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import cast

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.models import OcrJobHints, OcrJobMessage, PlayerAliasHint
from momo_ocr.shared.errors import FailureCode, OcrError

OCR_HINTS_KEY = "ocrHintsJson"
REQUEST_ID_KEY = "requestId"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
REPO_ROOT = Path(__file__).resolve().parents[6]
STREAM_PAYLOAD_SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "ocr-queue-payload-v1.schema.json"
OCR_HINTS_SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "ocr-hints-v1.schema.json"


def parse_job_message(payload: Mapping[str, object]) -> OcrJobMessage:
    hints_payload = _validate_stream_payload_schema(payload)
    raw_payload = cast("Mapping[str, str]", payload)

    image_path = _parse_absolute_path(raw_payload["imagePath"])

    try:
        requested_screen_type = ScreenType(raw_payload["requestedImageType"])
    except ValueError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            "Unsupported requestedImageType in OCR queue message: "
            f"{raw_payload['requestedImageType']}",
        ) from exc

    return OcrJobMessage(
        job_id=raw_payload["jobId"],
        draft_id=raw_payload["draftId"],
        image_id=raw_payload["imageId"],
        image_path=image_path,
        requested_screen_type=requested_screen_type,
        attempt=int(raw_payload["attempt"]),
        enqueued_at=raw_payload["enqueuedAt"],
        hints=_parse_hints(hints_payload),
        request_id=raw_payload.get(REQUEST_ID_KEY),
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


def _validate_stream_payload_schema(payload: Mapping[str, object]) -> Mapping[str, object] | None:
    _validate_json_schema(
        validator=_stream_payload_validator(),
        instance=dict(payload),
        failure_message="OCR queue message does not match Redis Streams payload schema.",
    )
    raw_hints = payload.get(OCR_HINTS_KEY)
    if raw_hints in (None, ""):
        return None
    try:
        hints = json.loads(cast("str", raw_hints))
    except json.JSONDecodeError as exc:
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue hints must be valid JSON.") from exc
    _validate_json_schema(
        validator=_ocr_hints_validator(),
        instance=hints,
        failure_message="OCR queue hints do not match hints schema.",
    )
    return cast("Mapping[str, object]", hints)


def _validate_json_schema(
    *,
    validator: Draft202012Validator,
    instance: object,
    failure_message: str,
) -> None:
    errors = sorted(validator.iter_errors(instance), key=lambda error: error.json_path)
    if errors:
        details = "; ".join(_schema_error_detail(error) for error in errors)
        raise OcrError(FailureCode.QUEUE_FAILURE, f"{failure_message} {details}")


def _schema_error_detail(error: ValidationError) -> str:
    path = error.json_path
    if path == "$":
        return error.message
    return f"{path}: {error.message}"


@lru_cache(maxsize=1)
def _stream_payload_validator() -> Draft202012Validator:
    return _validator_for(STREAM_PAYLOAD_SCHEMA_PATH)


@lru_cache(maxsize=1)
def _ocr_hints_validator() -> Draft202012Validator:
    return _validator_for(OCR_HINTS_SCHEMA_PATH)


def _validator_for(schema_path: Path) -> Draft202012Validator:
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise OcrError(
            FailureCode.QUEUE_FAILURE,
            f"OCR queue schema file is unavailable: {schema_path}",
        ) from exc
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def _parse_absolute_path(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise OcrError(FailureCode.QUEUE_FAILURE, "OCR queue message imagePath must be absolute.")
    return path


def _parse_hints(parsed_payload: Mapping[str, object] | None) -> OcrJobHints:
    if parsed_payload is None:
        return OcrJobHints()
    return OcrJobHints(
        game_title=cast("str | None", parsed_payload.get("gameTitle")),
        layout_family=cast("str | None", parsed_payload.get("layoutFamily")),
        known_player_aliases=_parse_known_player_aliases(parsed_payload.get("knownPlayerAliases")),
        computer_player_aliases=_string_tuple(parsed_payload.get("computerPlayerAliases")),
    )


def _parse_known_player_aliases(value: object) -> tuple[PlayerAliasHint, ...]:
    if value is None:
        return ()
    hints: list[PlayerAliasHint] = []
    for item in cast("list[object]", value):
        item_payload = cast("Mapping[str, object]", item)
        hints.append(
            PlayerAliasHint(
                member_id=cast("str", item_payload["memberId"]),
                aliases=_string_tuple(item_payload.get("aliases")),
            )
        )
    return tuple(hints)


def _string_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    return tuple(cast("list[str]", value))


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
