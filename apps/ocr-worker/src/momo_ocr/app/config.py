from __future__ import annotations

import os
import socket
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_TEMP_ROOT = Path("/tmp/momo-result/uploads")  # noqa: S108
DEFAULT_REDIS_STREAM = "momo:ocr:jobs"
DEFAULT_REDIS_GROUP = "momo-ocr-workers"
DEFAULT_REDIS_DEAD_LETTER_STREAM = "momo:ocr:jobs:dead"
DEFAULT_WORKER_CONCURRENCY = 1
DEFAULT_OCR_TIMEOUT_SECONDS = 30
DEFAULT_MAX_ATTEMPTS = 1


@dataclass(frozen=True)
class WorkerConfig:
    redis_url: str | None = None
    database_url: str | None = None
    worker_id: str = "momo-ocr-worker"
    redis_stream: str = DEFAULT_REDIS_STREAM
    redis_group: str = DEFAULT_REDIS_GROUP
    redis_dead_letter_stream: str = DEFAULT_REDIS_DEAD_LETTER_STREAM
    concurrency: int = DEFAULT_WORKER_CONCURRENCY
    ocr_timeout_seconds: int = DEFAULT_OCR_TIMEOUT_SECONDS
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    temp_root: Path = DEFAULT_TEMP_ROOT


def load_worker_config(env: Mapping[str, str] | None = None) -> WorkerConfig:
    source = os.environ if env is None else env
    return WorkerConfig(
        redis_url=_optional_non_empty(source, "REDIS_URL"),
        database_url=_optional_non_empty(source, "OCR_DATABASE_URL")
        or _optional_non_empty(source, "DATABASE_URL"),
        worker_id=source.get("OCR_WORKER_ID", _default_worker_id()),
        redis_stream=source.get("OCR_REDIS_STREAM", DEFAULT_REDIS_STREAM),
        redis_group=source.get("OCR_REDIS_GROUP", DEFAULT_REDIS_GROUP),
        redis_dead_letter_stream=source.get(
            "OCR_REDIS_DEAD_LETTER_STREAM",
            DEFAULT_REDIS_DEAD_LETTER_STREAM,
        ),
        concurrency=_int_from_env(source, "OCR_WORKER_CONCURRENCY", DEFAULT_WORKER_CONCURRENCY),
        ocr_timeout_seconds=_int_from_env(
            source,
            "OCR_TIMEOUT_SECONDS",
            DEFAULT_OCR_TIMEOUT_SECONDS,
        ),
        max_attempts=_int_from_env(source, "OCR_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
        temp_root=Path(source.get("IMAGE_TMP_DIR", str(DEFAULT_TEMP_ROOT))).absolute(),
    )


def require_production_config(config: WorkerConfig) -> None:
    missing = []
    if config.redis_url is None:
        missing.append("REDIS_URL")
    if config.database_url is None:
        missing.append("OCR_DATABASE_URL or DATABASE_URL")
    if missing:
        joined = ", ".join(missing)
        msg = f"Missing required OCR worker config: {joined}"
        raise ValueError(msg)
    if config.concurrency != DEFAULT_WORKER_CONCURRENCY:
        msg = (
            "OCR_WORKER_CONCURRENCY greater than 1 is not supported by this worker process yet; "
            "run multiple worker processes only after DB/Redis capacity is reviewed."
        )
        raise ValueError(msg)


def _optional_non_empty(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None or value == "":
        return None
    return value


def _int_from_env(env: Mapping[str, str], key: str, default: int) -> int:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    value = int(raw)
    if value < 1:
        msg = f"{key} must be a positive integer."
        raise ValueError(msg)
    return value


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"
