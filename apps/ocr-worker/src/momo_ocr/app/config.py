from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_TEMP_ROOT = Path("/tmp/momo-result/uploads")  # noqa: S108


@dataclass(frozen=True)
class WorkerConfig:
    redis_stream: str = "momo:ocr:jobs"
    redis_group: str = "momo-ocr-workers"
    redis_dead_letter_stream: str = "momo:ocr:jobs:dead"
    concurrency: int = 1
    ocr_timeout_seconds: int = 30
    max_attempts: int = 1
    temp_root: Path = DEFAULT_TEMP_ROOT
