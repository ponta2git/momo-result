from __future__ import annotations

from pathlib import Path
from typing import Protocol

from momo_ocr.features.ocr_jobs.cancellation import CancellationChecker
from momo_ocr.features.ocr_jobs.dependencies import AnalyzeImageFn
from momo_ocr.features.ocr_jobs.repository import OcrJobRepository
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine


class PipelineDependencies(Protocol):
    @property
    def repository(self) -> OcrJobRepository:
        raise NotImplementedError

    @property
    def cancellation(self) -> CancellationChecker:
        raise NotImplementedError

    @property
    def worker_id(self) -> str:
        raise NotImplementedError

    @property
    def analyze(self) -> AnalyzeImageFn:
        raise NotImplementedError

    @property
    def text_engine(self) -> TextRecognitionEngine:
        raise NotImplementedError

    @property
    def temp_root(self) -> Path | None:
        raise NotImplementedError

    @property
    def debug_dir_base(self) -> Path | None:
        raise NotImplementedError
