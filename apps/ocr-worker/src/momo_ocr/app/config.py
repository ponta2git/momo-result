from __future__ import annotations

import os
import socket
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from momo_ocr.features.text_recognition.fast_path import parse_fast_path_flag

DEFAULT_TEMP_ROOT = Path("/tmp/momo-result/uploads")  # noqa: S108
DEFAULT_REDIS_STREAM = "momo:ocr:jobs"
DEFAULT_REDIS_GROUP = "momo-ocr-workers"
DEFAULT_REDIS_DEAD_LETTER_STREAM = "momo:ocr:jobs:dead"
DEFAULT_WORKER_CONCURRENCY = 1
DEFAULT_OCR_TIMEOUT_SECONDS = 30
DEFAULT_MAX_ATTEMPTS = 1
DEFAULT_REDIS_CLAIM_IDLE_SECONDS = 300
DEFAULT_REDIS_BLOCK_SECONDS = 30
VALID_APP_ENVS = frozenset({"dev", "test", "prod"})


@dataclass(frozen=True)
class WorkerConfig:
    app_env: str = "dev"
    redis_url: str | None = None
    redis_allow_plaintext_in_prod: bool = False
    database_url: str | None = None
    worker_id: str = "momo-ocr-worker"
    redis_stream: str = DEFAULT_REDIS_STREAM
    redis_group: str = DEFAULT_REDIS_GROUP
    redis_dead_letter_stream: str = DEFAULT_REDIS_DEAD_LETTER_STREAM
    concurrency: int = DEFAULT_WORKER_CONCURRENCY
    ocr_timeout_seconds: int = DEFAULT_OCR_TIMEOUT_SECONDS
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    redis_claim_idle_seconds: int = DEFAULT_REDIS_CLAIM_IDLE_SECONDS
    redis_block_seconds: int = DEFAULT_REDIS_BLOCK_SECONDS
    temp_root: Path = DEFAULT_TEMP_ROOT
    fast_path_enabled: bool = False
    debug_dir_base: Path | None = None
    ocr_engine: str | None = None


def load_worker_config(env: Mapping[str, str] | None = None) -> WorkerConfig:
    source = os.environ if env is None else env
    return WorkerConfig(
        app_env=_app_env_from_env(source),
        redis_url=_optional_non_empty(source, "REDIS_URL"),
        redis_allow_plaintext_in_prod=_bool_from_env(
            source,
            "REDIS_ALLOW_PLAINTEXT_IN_PROD",
            default=False,
        ),
        database_url=_optional_non_empty(source, "OCR_DATABASE_URL")
        or _optional_non_empty(source, "DATABASE_URL"),
        worker_id=_non_empty_or_default(source, "OCR_WORKER_ID", _default_worker_id()),
        redis_stream=_non_empty_or_default(source, "OCR_REDIS_STREAM", DEFAULT_REDIS_STREAM),
        redis_group=_non_empty_or_default(source, "OCR_REDIS_GROUP", DEFAULT_REDIS_GROUP),
        redis_dead_letter_stream=_non_empty_or_default(
            source,
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
        redis_claim_idle_seconds=_int_from_env(
            source,
            "OCR_REDIS_CLAIM_IDLE_SECONDS",
            DEFAULT_REDIS_CLAIM_IDLE_SECONDS,
        ),
        redis_block_seconds=_int_from_env(
            source,
            "OCR_REDIS_BLOCK_SECONDS",
            DEFAULT_REDIS_BLOCK_SECONDS,
        ),
        temp_root=_path_from_env(source, "IMAGE_TMP_DIR", DEFAULT_TEMP_ROOT),
        fast_path_enabled=parse_fast_path_flag(source.get("MOMO_OCR_FAST_PATH")),
        debug_dir_base=_optional_path(source, "MOMO_OCR_DEBUG_DIR"),
        ocr_engine=_optional_non_empty(source, "MOMO_OCR_ENGINE"),
    )


def require_production_config(config: WorkerConfig) -> None:
    if config.app_env not in VALID_APP_ENVS:
        msg = "APP_ENV must be one of: dev, test, prod."
        raise ValueError(msg)
    missing = []
    if config.redis_url is None:
        missing.append("REDIS_URL")
    if config.database_url is None:
        missing.append("OCR_DATABASE_URL or DATABASE_URL")
    if missing:
        joined = ", ".join(missing)
        msg = f"Missing required OCR worker config: {joined}"
        raise ValueError(msg)
    if (
        config.app_env == "prod"
        and not config.redis_allow_plaintext_in_prod
        and not _redis_url_uses_tls(config.redis_url)
    ):
        msg = "REDIS_URL must use rediss:// when APP_ENV=prod."
        raise ValueError(msg)
    if (
        config.app_env == "prod"
        and config.redis_allow_plaintext_in_prod
        and not _redis_url_valid(
            config.redis_url,
        )
    ):
        msg = "REDIS_URL must use rediss://, or redis:// when REDIS_ALLOW_PLAINTEXT_IN_PROD=true."
        raise ValueError(msg)


def _optional_non_empty(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None or value == "":
        return None
    return value


def _non_empty_or_default(env: Mapping[str, str], key: str, default: str) -> str:
    return _optional_non_empty(env, key) or default


def _app_env_from_env(env: Mapping[str, str]) -> str:
    value = env.get("APP_ENV", "dev").strip().lower()
    if value not in VALID_APP_ENVS:
        msg = "APP_ENV must be one of: dev, test, prod."
        raise ValueError(msg)
    return value


def _redis_url_uses_tls(redis_url: str | None) -> bool:
    return redis_url is not None and urlsplit(redis_url).scheme.lower() == "rediss"


def _redis_url_valid(redis_url: str | None) -> bool:
    if redis_url is None:
        return False
    return urlsplit(redis_url).scheme.lower() in {"redis", "rediss"}


def _bool_from_env(env: Mapping[str, str], key: str, *, default: bool) -> bool:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    if raw.lower() == "true":
        return True
    if raw.lower() == "false":
        return False
    msg = f"{key} must be true or false."
    raise ValueError(msg)


def _optional_path(env: Mapping[str, str], key: str) -> Path | None:
    value = _optional_non_empty(env, key)
    if value is None or value.strip() == "":
        return None
    return _normalized_path(value)


def _path_from_env(env: Mapping[str, str], key: str, default: Path) -> Path:
    return _normalized_path(env.get(key, str(default)))


def _normalized_path(value: str) -> Path:
    return Path(value).expanduser().absolute()


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
