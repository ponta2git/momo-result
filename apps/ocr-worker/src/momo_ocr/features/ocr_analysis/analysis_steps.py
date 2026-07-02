from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from momo_ocr.features.ocr_domain.models import (
    OcrDraftPayload,
    OcrWarning,
    ScreenType,
    WarningCode,
    WarningSeverity,
)
from momo_ocr.features.ocr_results.parsing import ParserRegistry, ScreenParseContext
from momo_ocr.features.ocr_results.player_aliases import (
    DEFAULT_ALIAS_RESOLVER,
    PlayerAliasResolver,
)
from momo_ocr.features.ocr_results.registry import default_parser_registry
from momo_ocr.features.player_order.detector import detect_player_order
from momo_ocr.features.player_order.models import PlayerOrderDetection
from momo_ocr.features.screen_detection.classifier import classify_screen_type, detection_failure
from momo_ocr.features.screen_detection.models import ScreenDetectionResult
from momo_ocr.features.screen_detection.title_evidence import recognize_title_evidence
from momo_ocr.features.temp_images.models import ImageMetadata
from momo_ocr.features.temp_images.storage import resolve_local_image
from momo_ocr.features.temp_images.validation import read_image_metadata
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.shared.errors import OcrError


@dataclass(frozen=True)
class AnalysisConfig:
    requested_type: ScreenType
    debug_dir: Path | None
    include_raw_text: bool
    engine: TextRecognitionEngine
    registry: ParserRegistry
    layout_family_hint: str | None
    alias_resolver: PlayerAliasResolver
    fast_path_enabled: bool


def build_analysis_config(  # noqa: PLR0913
    *,
    requested_screen_type: str,
    debug_dir: Path | None,
    include_raw_text: bool,
    engine: TextRecognitionEngine,
    parser_registry: ParserRegistry | None,
    layout_family_hint: str | None,
    alias_resolver: PlayerAliasResolver | None,
    fast_path_enabled: bool,
) -> AnalysisConfig:
    return AnalysisConfig(
        requested_type=ScreenType(requested_screen_type),
        debug_dir=debug_dir,
        include_raw_text=include_raw_text,
        engine=engine,
        registry=parser_registry if parser_registry is not None else default_parser_registry(),
        layout_family_hint=layout_family_hint,
        alias_resolver=alias_resolver if alias_resolver is not None else DEFAULT_ALIAS_RESOLVER,
        fast_path_enabled=fast_path_enabled,
    )


def validate_image(
    image_path: Path,
    *,
    image_root: Path | None,
    enforce_size_limit: bool,
) -> tuple[Path, ImageMetadata]:
    resolved_path = resolve_local_image(image_path, root=image_root)
    metadata = read_image_metadata(resolved_path, enforce_size_limit=enforce_size_limit)
    return resolved_path, metadata


def detect_screen(image: Image.Image, config: AnalysisConfig) -> ScreenDetectionResult:
    if config.requested_type != ScreenType.AUTO:
        return classify_screen_type(config.requested_type, {})
    try:
        evidence = recognize_title_evidence(
            image,
            config.engine,
            debug_dir=_child_debug_dir(config.debug_dir, "screen_detection"),
        )
        return classify_screen_type(config.requested_type, evidence)
    except OcrError as exc:
        return detection_failure(
            config.requested_type,
            message=f"Screen type detection failed: {exc.message}",
        )


def detect_player_order_for_analysis(
    image: Image.Image,
    config: AnalysisConfig,
) -> PlayerOrderDetection:
    return detect_player_order(
        image,
        text_engine=config.engine,
        debug_dir=_child_debug_dir(config.debug_dir, "player_order"),
    )


def analysis_warnings(
    detection: ScreenDetectionResult,
    player_order_detection: PlayerOrderDetection,
    *,
    debug_dir: Path | None,
) -> list[OcrWarning]:
    warnings = [*detection.warnings, *player_order_detection.warnings]
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)
        warnings.append(_debug_output_warning())
    return warnings


def parse_detected_screen(
    *,
    image: Image.Image,
    image_path: Path,
    detection: ScreenDetectionResult,
    player_order_detection: PlayerOrderDetection,
    warnings: list[OcrWarning],
    config: AnalysisConfig,
) -> OcrDraftPayload | None:
    if detection.detected_type is None or detection.profile_id is None:
        return None
    parser = config.registry.get(detection.detected_type)
    return parser.parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=config.requested_type,
            detected_screen_type=detection.detected_type,
            profile_id=detection.profile_id,
            debug_dir=config.debug_dir,
            include_raw_text=config.include_raw_text,
            text_engine=config.engine,
            player_order_detection=player_order_detection,
            warnings=tuple(warnings),
            layout_family_hint=config.layout_family_hint,
            alias_resolver=config.alias_resolver,
            fast_path_enabled=config.fast_path_enabled,
            image=image,
        )
    )


def _child_debug_dir(debug_dir: Path | None, child: str) -> Path | None:
    return debug_dir / child if debug_dir is not None else None


def _debug_output_warning() -> OcrWarning:
    return OcrWarning(
        code=WarningCode.DEBUG_OUTPUT_ENABLED,
        message=(
            "Debug directory was created; screen-detection and parser artifacts may be written."
        ),
        severity=WarningSeverity.INFO,
    )
