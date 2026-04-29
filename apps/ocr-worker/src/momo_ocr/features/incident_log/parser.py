from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.incident_log.postprocess import parse_count
from momo_ocr.features.incident_log.profile import (
    MVP_INCIDENT_NAMES,
    IncidentLogProfile,
    select_incident_log_profiles,
)
from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrField,
    OcrWarning,
    PlayerResultDraft,
    ScreenType,
    WarningCode,
)
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.player_order.detector import apply_player_order_to_column_players
from momo_ocr.features.temp_images.validation import open_decoded_image
from momo_ocr.features.text_recognition.models import RecognitionConfig, RecognitionField
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text

COUNT_OCR_PSMS = (10, 13)
PLAYER_COUNT = 4


@dataclass(frozen=True)
class IncidentParseAttempt:
    profile: IncidentLogProfile
    player_counts: list[dict[str, OcrField[int]]]
    warnings: list[OcrWarning]
    raw_snippets: dict[str, str]

    @property
    def missing_count(self) -> int:
        return sum(
            1 for counts in self.player_counts for field in counts.values() if field.value is None
        )


@dataclass(frozen=True)
class IncidentLogParser:
    screen_type: ScreenType = ScreenType.INCIDENT_LOG

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = open_decoded_image(context.image_path)
        image_size = Size(width=image.width, height=image.height)
        debug_dir = context.debug_dir / "incident_log" if context.debug_dir is not None else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        profiles = select_incident_log_profiles(context.layout_family_hint)
        attempts = [
            _parse_profile(
                context=context,
                image=image,
                image_size=image_size,
                profile=profile,
                debug_dir=debug_dir,
                isolate_debug=len(profiles) > 1,
            )
            for profile in profiles
        ]
        selected_attempt = min(attempts, key=lambda attempt: attempt.missing_count)

        warnings = [*context.warnings, *selected_attempt.warnings]
        players = [PlayerResultDraft(incidents=counts) for counts in selected_attempt.player_counts]
        players = apply_player_order_to_column_players(players, context.player_order_detection)
        rows = [
            IncidentLogRow(
                raw_player_name=None,
                counts={
                    incident_name: selected_attempt.player_counts[player_index][incident_name].value
                    for incident_name in MVP_INCIDENT_NAMES
                },
                confidence=None,
                warnings=[
                    warning.code.value
                    for warning in warnings
                    if warning.field_path is not None
                    and warning.field_path.startswith(f"players[{player_index}].")
                ],
            )
            for player_index in range(PLAYER_COUNT)
        ]
        return OcrDraftPayload(
            requested_screen_type=context.requested_screen_type,
            detected_screen_type=context.detected_screen_type,
            profile_id=context.profile_id,
            players=players,
            category_payload={
                "status": "parsed",
                "parser": "incident_log",
                "layout_profile_id": selected_attempt.profile.id,
                "incident_names": MVP_INCIDENT_NAMES,
                "rows": rows,
                "player_order": context.player_order_detection,
                "include_raw_text": context.include_raw_text,
            },
            warnings=warnings,
            raw_snippets=selected_attempt.raw_snippets if context.include_raw_text else None,
        )


def _parse_profile(
    *,
    context: ScreenParseContext,
    image: Image.Image,
    image_size: Size,
    profile: IncidentLogProfile,
    debug_dir: Path | None,
    isolate_debug: bool,
) -> IncidentParseAttempt:
    profile_debug_dir = (
        debug_dir / profile.id if debug_dir is not None and isolate_debug else debug_dir
    )
    if profile_debug_dir is not None:
        profile_debug_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[OcrWarning] = []
    raw_snippets: dict[str, str] = {}
    player_counts = [
        {incident_name: OcrField[int](value=None) for incident_name in MVP_INCIDENT_NAMES}
        for _ in range(PLAYER_COUNT)
    ]

    for row_profile in profile.row_profiles:
        for player_index, cell_roi in enumerate(row_profile.cell_rois):
            cell_image = crop_roi(image, scale_profile_rect_to_image(cell_roi, image_size))
            prepared_cell = _prepare_count_cell_image(cell_image)
            if profile_debug_dir is not None:
                suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
                cell_image.save(profile_debug_dir / f"{suffix}_cell.png")
                prepared_cell.save(profile_debug_dir / f"{suffix}_cell_prepared.png")

            raw_text, confidence = _recognize_count_cell(context, prepared_cell)
            count = parse_count(raw_text)
            field_path = f"players[{player_index}].incidents[{row_profile.incident_name!r}]"
            raw_snippets[f"{row_profile.incident_name}_player_{player_index + 1}"] = raw_text
            if count is None:
                warnings.append(
                    _missing_count_warning(row_profile.incident_name, player_index, field_path)
                )
            player_counts[player_index][row_profile.incident_name] = OcrField(
                value=count,
                raw_text=raw_text,
                confidence=confidence,
            )

    return IncidentParseAttempt(
        profile=profile,
        player_counts=player_counts,
        warnings=warnings,
        raw_snippets=raw_snippets,
    )


def _missing_count_warning(incident_name: str, player_index: int, field_path: str) -> OcrWarning:
    return OcrWarning(
        code=WarningCode.MISSING_INCIDENT_COUNT,
        message=f"Could not read {incident_name} count for player column {player_index + 1}.",
        field_path=field_path,
    )


def _prepare_count_cell_image(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    enhanced = ImageEnhance.Contrast(gray).enhance(4.0)
    return enhanced.resize((enhanced.width * 5, enhanced.height * 5), Image.Resampling.LANCZOS)


def _recognize_count_cell(
    context: ScreenParseContext,
    image: Image.Image,
) -> tuple[str, float | None]:
    snippets: list[str] = []
    confidences: list[float] = []
    for psm in COUNT_OCR_PSMS:
        recognized = context.text_engine.recognize(
            image,
            field=RecognitionField.INCIDENT_LOG,
            config=RecognitionConfig(
                language="eng",
                psm=psm,
                variables={"tessedit_char_whitelist": "0123456789OoＯｏIl|｜i"},
            ),
        )
        text = normalize_ocr_text(recognized.text)
        if text and text not in snippets:
            snippets.append(text)
        if recognized.confidence is not None:
            confidences.append(recognized.confidence)
    confidence = min(confidences) if confidences else None
    return " | ".join(snippets), confidence
