from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_analysis.analyze_image import analyze_image
from momo_ocr.features.ocr_analysis.report import AnalysisResult
from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.consumer import OcrJobConsumer
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.ocr_results.player_aliases import PlayerAliasResolver
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)


class AnalyzeImageFn(Protocol):
    def __call__(  # noqa: PLR0913 - mirrors the analyzer boundary explicitly.
        self,
        *,
        image_path: Path,
        requested_screen_type: str,
        debug_dir: Path | None,
        include_raw_text: bool,
        text_engine: TextRecognitionEngine | None = None,
        layout_family_hint: str | None = None,
        alias_resolver: PlayerAliasResolver | None = None,
        image_root: Path | None = None,
        enforce_size_limit: bool = False,
        fast_path_enabled: bool = False,
    ) -> AnalysisResult:
        raise NotImplementedError


@dataclass(frozen=True)
class JobRunnerDependencies:
    """Wiring shared by the OCR job runner and pipeline.

    All transports are injected so the runner can be exercised against
    in-memory fakes in tests and against real Redis/Postgres adapters in
    production. The ``analyze`` callable defaults to the real OCR pipeline
    but is overridable for fast unit tests.

    ``text_engine`` is the long-lived OCR engine instance. Wiring a single
    engine into the runner ensures we do not pay engine-construction or
    PATH-resolution costs per job. The default ``FakeTextRecognitionEngine``
    keeps unit tests that override ``analyze`` with a no-op friendly to
    construct without standing up Tesseract.
    """

    consumer: OcrJobConsumer
    repository: OcrJobRepository
    cancellation: CancellationChecker
    worker_id: str
    analyze: AnalyzeImageFn = analyze_image
    text_engine: TextRecognitionEngine = field(default_factory=FakeTextRecognitionEngine)
    temp_root: Path | None = None
    fast_path_enabled: bool = False
    debug_dir_base: Path | None = None
