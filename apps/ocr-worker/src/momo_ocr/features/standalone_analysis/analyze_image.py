from __future__ import annotations

from pathlib import Path

from momo_ocr.features.ocr_results.models import (
    OcrWarning,
    WarningCode,
    WarningSeverity,
)
from momo_ocr.features.ocr_results.parsing import ParseContext
from momo_ocr.features.ocr_results.registry import default_parser_registry
from momo_ocr.features.screen_detection.classifier import detect_screen_type
from momo_ocr.features.screen_detection.models import ImageType
from momo_ocr.features.standalone_analysis.report import AnalysisResult
from momo_ocr.features.temp_images.storage import resolve_local_image
from momo_ocr.features.temp_images.validation import read_image_metadata
from momo_ocr.shared.errors import OcrError
from momo_ocr.shared.time import record_duration_ms


def analyze_image(
    *,
    image_path: Path,
    requested_image_type: str,
    debug_dir: Path | None,
    include_raw_text: bool,
) -> AnalysisResult:
    timings: dict[str, float] = {}
    metadata = None
    detection = None

    try:
        with record_duration_ms(timings, "validate_image"):
            resolved_path = resolve_local_image(image_path)
            metadata = read_image_metadata(resolved_path, enforce_size_limit=False)

        with record_duration_ms(timings, "detect_screen"):
            detection = detect_screen_type(resolved_path, ImageType(requested_image_type))

        warnings = list(detection.warnings)
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)
            warnings.append(
                OcrWarning(
                    code=WarningCode.DEBUG_OUTPUT_ENABLED,
                    message=(
                        "Debug directory was created; ROI debug images will be added with parsers."
                    ),
                    severity=WarningSeverity.INFO,
                )
            )

        if detection.detected_type is None or detection.profile_id is None:
            parsed = None
        else:
            parser = default_parser_registry().get(detection.detected_type)
            parsed = parser.parse(
                ParseContext(
                    image_path=resolved_path,
                    requested_image_type=ImageType(requested_image_type),
                    detected_image_type=detection.detected_type,
                    profile_id=detection.profile_id,
                    debug_dir=debug_dir,
                    include_raw_text=include_raw_text,
                    warnings=warnings,
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
