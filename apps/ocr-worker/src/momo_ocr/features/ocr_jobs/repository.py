from __future__ import annotations

from momo_ocr.features.ocr_jobs.postgres_repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.repository_contract import OcrJobRepository

__all__ = [
    "OcrJobRepository",
    "PostgresOcrJobRepository",
]
