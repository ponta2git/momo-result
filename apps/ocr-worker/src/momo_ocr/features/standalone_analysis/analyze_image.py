from __future__ import annotations

from pathlib import Path

from momo_ocr.app.composition import default_parser_registry, default_text_recognition_engine
from momo_ocr.features.ocr_domain.models import (
    OcrWarning,
    ScreenType,
    WarningCode,
    WarningSeverity,
)
from momo_ocr.features.ocr_results.parsing import ParserRegistry, ScreenParseContext
from momo_ocr.features.player_order.detector import detect_player_order
from momo_ocr.features.player_order.models import PlayerOrderDetection
from momo_ocr.features.screen_detection.classifier import classify_screen_type, detection_failure
from momo_ocr.features.screen_detection.title_evidence import recognize_title_evidence
from momo_ocr.features.standalone_analysis.layout_family import detect_layout_family_from_filename
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.features.temp_images.storage import resolve_local_image
from momo_ocr.features.temp_images.validation import open_decoded_image, read_image_metadata
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.shared.errors import OcrError
from momo_ocr.shared.time import record_duration_ms


def analyze_image(  # noqa: PLR0913
    *,
    image_path: Path,
    requested_screen_type: str,
    debug_dir: Path | None,
    include_raw_text: bool,
    text_engine: TextRecognitionEngine | None = None,
    parser_registry: ParserRegistry | None = None,
    layout_family_hint: str | None = None,
) -> AnalysisResult:
    timings: dict[str, float] = {}
    metadata = None
    detection = None
    player_order_detection: PlayerOrderDetection | None = None
    requested_type = ScreenType(requested_screen_type)
    engine = text_engine if text_engine is not None else default_text_recognition_engine()
    registry = parser_registry if parser_registry is not None else default_parser_registry()
    resolved_layout_family_hint = layout_family_hint or detect_layout_family_from_filename(
        image_path,
    )

    try:
        with record_duration_ms(timings, "validate_image"):
            resolved_path = resolve_local_image(image_path)
            metadata = read_image_metadata(resolved_path, enforce_size_limit=False)

        with record_duration_ms(timings, "detect_screen"):
            if requested_type == ScreenType.AUTO:
                try:
                    image = open_decoded_image(resolved_path)
                    evidence = recognize_title_evidence(
                        image,
                        engine,
                        debug_dir=debug_dir / "screen_detection" if debug_dir is not None else None,
                    )
                    detection = classify_screen_type(requested_type, evidence)
                except OcrError as exc:
                    detection = detection_failure(
                        requested_type,
                        message=f"Screen type detection failed: {exc.message}",
                    )
            else:
                detection = classify_screen_type(requested_type, {})

        with record_duration_ms(timings, "detect_player_order"):
            image = open_decoded_image(resolved_path)
            player_order_detection = detect_player_order(
                image,
                text_engine=engine,
                debug_dir=debug_dir / "player_order" if debug_dir is not None else None,
            )

        warnings = list(detection.warnings)
        warnings.extend(player_order_detection.warnings)
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)
            warnings.append(
                OcrWarning(
                    code=WarningCode.DEBUG_OUTPUT_ENABLED,
                    message=(
                        "Debug directory was created; screen-detection and parser artifacts "
                        "may be written."
                    ),
                    severity=WarningSeverity.INFO,
                )
            )

        if detection.detected_type is None or detection.profile_id is None:
            parsed = None
        else:
            parser = registry.get(detection.detected_type)
            parsed = parser.parse(
                ScreenParseContext(
                    image_path=resolved_path,
                    requested_screen_type=requested_type,
                    detected_screen_type=detection.detected_type,
                    profile_id=detection.profile_id,
                    debug_dir=debug_dir,
                    include_raw_text=include_raw_text,
                    text_engine=engine,
                    player_order_detection=player_order_detection,
                    warnings=warnings,
                    layout_family_hint=resolved_layout_family_hint,
                )
            )

        return AnalysisResult(
            input=metadata,
            detection=detection,
            result=parsed,
            warnings=warnings,
            failure_code=None,
            failure_message=None,
            failure_retryable=False,
            failure_user_action=None,
            timings_ms=timings,
        )
    except OcrError as exc:
        return AnalysisResult(
            input=metadata,
            detection=detection,
            result=None,
            warnings=[],
            failure_code=exc.code.value,
            failure_message=exc.message,
            failure_retryable=exc.retryable,
            failure_user_action=exc.user_action,
            timings_ms=timings,
        )
