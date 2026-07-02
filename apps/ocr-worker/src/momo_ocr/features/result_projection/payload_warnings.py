"""Merge runtime warnings into an :class:`OcrDraftPayload` deterministically."""

from __future__ import annotations

from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning


def attach_warnings_to_payload(
    payload: OcrDraftPayload, warnings: list[OcrWarning]
) -> OcrDraftPayload:
    """Return a copy of ``payload`` whose ``warnings`` include ``warnings``.

    Duplicates (matched on ``(code, message, field_path)``) are dropped.
    """
    if not warnings:
        return payload
    merged = list(payload.warnings)
    seen = {(w.code, w.message, w.field_path) for w in merged}
    for warning in warnings:
        key = (warning.code, warning.message, warning.field_path)
        if key in seen:
            continue
        merged.append(warning)
        seen.add(key)
    return OcrDraftPayload(
        requested_screen_type=payload.requested_screen_type,
        detected_screen_type=payload.detected_screen_type,
        profile_id=payload.profile_id,
        players=payload.players,
        category_payload=payload.category_payload,
        warnings=merged,
        raw_snippets=payload.raw_snippets,
    )
