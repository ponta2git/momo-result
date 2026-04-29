from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageEnhance, ImageOps

from momo_ocr.features.image_processing.geometry import Size, scale_profile_rect_to_image
from momo_ocr.features.image_processing.roi import crop_roi
from momo_ocr.features.incident_log.models import IncidentLogRow
from momo_ocr.features.incident_log.postprocess import parse_count
from momo_ocr.features.incident_log.profile import MVP_INCIDENT_NAMES, ROW_PROFILES
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
class IncidentLogParser:
    screen_type: ScreenType = ScreenType.INCIDENT_LOG

    def parse(self, context: ScreenParseContext) -> OcrDraftPayload:
        image = open_decoded_image(context.image_path)
        image_size = Size(width=image.width, height=image.height)
        warnings = list(context.warnings)
        raw_snippets: dict[str, str] = {}
        player_counts = [
            {incident_name: OcrField[int](value=None) for incident_name in MVP_INCIDENT_NAMES}
            for _ in range(PLAYER_COUNT)
        ]

        debug_dir = context.debug_dir / "incident_log" if context.debug_dir is not None else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        for row_profile in ROW_PROFILES:
            for player_index, cell_roi in enumerate(row_profile.cell_rois):
                cell_image = crop_roi(image, scale_profile_rect_to_image(cell_roi, image_size))
                prepared_cell = _prepare_count_cell_image(cell_image)
                if debug_dir is not None:
                    suffix = f"{row_profile.incident_name}_player_{player_index + 1}"
                    cell_image.save(debug_dir / f"{suffix}_cell.png")
                    prepared_cell.save(debug_dir / f"{suffix}_cell_prepared.png")

                raw_text, confidence = _recognize_count_cell(context, prepared_cell)
                count = parse_count(raw_text)
                field_path = f"players[{player_index}].incidents[{row_profile.incident_name!r}]"
                raw_snippets[f"{row_profile.incident_name}_player_{player_index + 1}"] = raw_text
                if count is None:
                    warnings.append(
                        OcrWarning(
                            code=WarningCode.MISSING_INCIDENT_COUNT,
                            message=(
                                f"Could not read {row_profile.incident_name} count "
                                f"for player column {player_index + 1}."
                            ),
                            field_path=field_path,
                        )
                    )
                player_counts[player_index][row_profile.incident_name] = OcrField(
                    value=count,
                    raw_text=raw_text,
                    confidence=confidence,
                )

        players = [PlayerResultDraft(incidents=counts) for counts in player_counts]
        players = apply_player_order_to_column_players(players, context.player_order_detection)
        rows = [
            IncidentLogRow(
                raw_player_name=None,
                counts={
                    incident_name: player_counts[player_index][incident_name].value
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
                "incident_names": MVP_INCIDENT_NAMES,
                "rows": rows,
                "player_order": context.player_order_detection,
                "include_raw_text": context.include_raw_text,
            },
            warnings=warnings,
            raw_snippets=raw_snippets if context.include_raw_text else None,
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
