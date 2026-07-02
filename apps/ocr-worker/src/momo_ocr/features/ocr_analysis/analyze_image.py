from __future__ import annotations

from contextlib import closing
from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_analysis.analysis_steps import (
    AnalysisConfig,
    analysis_warnings,
    build_analysis_config,
    detect_player_order_for_analysis,
    detect_screen,
    parse_detected_screen,
    validate_image,
)
from momo_ocr.features.ocr_analysis.report import AnalysisResult
from momo_ocr.features.ocr_domain.models import OcrDraftPayload, OcrWarning
from momo_ocr.features.ocr_results.parsing import ParserRegistry
from momo_ocr.features.ocr_results.player_aliases import PlayerAliasResolver
from momo_ocr.features.screen_detection.models import ScreenDetectionResult
from momo_ocr.features.temp_images.models import ImageMetadata
from momo_ocr.features.temp_images.validation import open_decoded_image
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine, close_text_engine
from momo_ocr.features.text_recognition.factory import default_text_recognition_engine
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
    alias_resolver: PlayerAliasResolver | None = None,
    image_root: Path | None = None,
    enforce_size_limit: bool = False,
    fast_path_enabled: bool = False,
) -> AnalysisResult:
    owns_engine = text_engine is None
    engine = text_engine if text_engine is not None else default_text_recognition_engine()
    try:
        return _analyze_image_with_engine(
            image_path=image_path,
            requested_screen_type=requested_screen_type,
            debug_dir=debug_dir,
            include_raw_text=include_raw_text,
            engine=engine,
            parser_registry=parser_registry,
            layout_family_hint=layout_family_hint,
            alias_resolver=alias_resolver,
            image_root=image_root,
            enforce_size_limit=enforce_size_limit,
            fast_path_enabled=fast_path_enabled,
        )
    finally:
        if owns_engine:
            close_text_engine(engine)


def _analyze_image_with_engine(  # noqa: PLR0913
    *,
    image_path: Path,
    requested_screen_type: str,
    debug_dir: Path | None,
    include_raw_text: bool,
    engine: TextRecognitionEngine,
    parser_registry: ParserRegistry | None,
    layout_family_hint: str | None,
    alias_resolver: PlayerAliasResolver | None,
    image_root: Path | None,
    enforce_size_limit: bool,
    fast_path_enabled: bool,
) -> AnalysisResult:
    timings: dict[str, float] = {}
    metadata: ImageMetadata | None = None
    detection: ScreenDetectionResult | None = None
    config = build_analysis_config(
        requested_screen_type=requested_screen_type,
        debug_dir=debug_dir,
        include_raw_text=include_raw_text,
        engine=engine,
        parser_registry=parser_registry,
        layout_family_hint=layout_family_hint,
        alias_resolver=alias_resolver,
        fast_path_enabled=fast_path_enabled,
    )

    try:
        with record_duration_ms(timings, "validate_image"):
            resolved_path, metadata = validate_image(
                image_path,
                image_root=image_root,
                enforce_size_limit=enforce_size_limit,
            )

        # Decode the image exactly once for the entire analyze pipeline.
        # Screen detection, player-order detection, and the screen parser
        # all read from this single decoded RGB Image instance via
        # ScreenParseContext.image. Closing at scope exit releases the pixel
        # buffer deterministically for long-running workers.
        with closing(open_decoded_image(resolved_path)) as decoded_image:
            return _analyze_decoded_image(
                decoded_image=decoded_image,
                resolved_path=resolved_path,
                metadata=metadata,
                config=config,
                timings=timings,
            )
    except OcrError as exc:
        return _failure_result(
            metadata=metadata,
            detection=detection,
            error=exc,
            timings=timings,
        )


def _analyze_decoded_image(
    *,
    decoded_image: Image.Image,
    resolved_path: Path,
    metadata: ImageMetadata,
    config: AnalysisConfig,
    timings: dict[str, float],
) -> AnalysisResult:
    with record_duration_ms(timings, "detect_screen"):
        detection = detect_screen(decoded_image, config)

    with record_duration_ms(timings, "detect_player_order"):
        player_order_detection = detect_player_order_for_analysis(decoded_image, config)

    warnings = analysis_warnings(
        detection,
        player_order_detection,
        debug_dir=config.debug_dir,
    )
    parsed = parse_detected_screen(
        image=decoded_image,
        image_path=resolved_path,
        detection=detection,
        player_order_detection=player_order_detection,
        warnings=warnings,
        config=config,
    )
    return _success_result(
        metadata=metadata,
        detection=detection,
        parsed=parsed,
        warnings=warnings,
        timings=timings,
    )


def _success_result(
    *,
    metadata: ImageMetadata,
    detection: ScreenDetectionResult,
    parsed: OcrDraftPayload | None,
    warnings: list[OcrWarning],
    timings: dict[str, float],
) -> AnalysisResult:
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


def _failure_result(
    *,
    metadata: ImageMetadata | None,
    detection: ScreenDetectionResult | None,
    error: OcrError,
    timings: dict[str, float],
) -> AnalysisResult:
    return AnalysisResult(
        input=metadata,
        detection=detection,
        result=None,
        warnings=[],
        failure_code=error.code.value,
        failure_message=error.message,
        failure_retryable=error.retryable,
        failure_user_action=error.user_action,
        timings_ms=timings,
    )
