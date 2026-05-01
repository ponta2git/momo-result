from __future__ import annotations

import os
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from momo_ocr.app.config import WorkerConfig, require_production_config
from momo_ocr.features.incident_log.parser import IncidentLogParser
from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_jobs.cancellation import RepositoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import PostgresOcrResultWriter
from momo_ocr.features.ocr_results.parsing import ParserRegistry
from momo_ocr.features.revenue.parser import RevenueParser
from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine
from momo_ocr.features.total_assets.parser import TotalAssetsParser
from momo_ocr.shared.errors import FailureCode, OcrError

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies


def default_parser_registry() -> ParserRegistry:
    return ParserRegistry(
        parsers={
            ScreenType.TOTAL_ASSETS: TotalAssetsParser(),
            ScreenType.REVENUE: RevenueParser(),
            ScreenType.INCIDENT_LOG: IncidentLogParser(),
        }
    )


_ENV_OCR_ENGINE = "MOMO_OCR_ENGINE"
_VALID_ENGINES = ("subprocess", "tesserocr")


def default_text_recognition_engine() -> TextRecognitionEngine:
    return text_recognition_engine_from_env(os.environ.get(_ENV_OCR_ENGINE))


def text_recognition_engine_from_env(value: str | None) -> TextRecognitionEngine:
    """Build the engine selected by ``MOMO_OCR_ENGINE``.

    ``value`` is the raw env value (``None``/empty falls back to the default).
    Default is ``tesserocr`` after Phase C canary eval matched subprocess
    accuracy exactly (489/504 = 97.02%) while cutting per-image latency by
    ~85% (p50 5370ms→830ms). Set ``MOMO_OCR_ENGINE=subprocess`` to revert.
    """
    name = (value or "tesserocr").strip().lower()
    if name == "subprocess":
        return TesseractEngine()
    if name == "tesserocr":
        return TesserocrEngine()
    msg = f"Unknown {_ENV_OCR_ENGINE}={value!r}; expected one of {_VALID_ENGINES}."
    raise OcrError(
        FailureCode.OCR_ENGINE_UNAVAILABLE,
        msg,
        retryable=False,
        user_action=f"Set {_ENV_OCR_ENGINE} to 'subprocess' or 'tesserocr'.",
    )


def redis_consumer_from_config(config: WorkerConfig) -> RedisOcrJobConsumer:
    return RedisOcrJobConsumer.from_config(config)


def postgres_repository_from_config(config: WorkerConfig) -> PostgresOcrJobRepository:
    if config.database_url is None:
        msg = "OCR_DATABASE_URL or DATABASE_URL is required for the Postgres OCR repository."
        raise ValueError(msg)
    return PostgresOcrJobRepository(_with_sslmode_require(config.database_url))


def postgres_writer_from_config(config: WorkerConfig) -> PostgresOcrResultWriter:
    if config.database_url is None:
        msg = "OCR_DATABASE_URL or DATABASE_URL is required for the Postgres OCR result writer."
        raise ValueError(msg)
    return PostgresOcrResultWriter(_with_sslmode_require(config.database_url))


def production_job_runner_dependencies(config: WorkerConfig) -> JobRunnerDependencies:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies  # noqa: PLC0415

    require_production_config(config)
    consumer = redis_consumer_from_config(config)
    repository = postgres_repository_from_config(config)
    # Construct one TesseractEngine for the entire worker process so we
    # pay shutil.which() and field-config setup exactly once. The runner
    # then re-uses this instance for every job.
    text_engine = default_text_recognition_engine()
    return JobRunnerDependencies(
        consumer=consumer,
        repository=repository,
        result_writer=postgres_writer_from_config(config),
        cancellation=RepositoryCancellationChecker(repository),
        worker_id=config.worker_id,
        text_engine=text_engine,
    )


def _with_sslmode_require(database_url: str) -> str:
    """Add sslmode=require unless the host is localhost/127.0.0.1 (local dev)."""
    parts = urlsplit(database_url)
    host = parts.hostname or ""
    _local_hosts = {"localhost", "127.0.0.1", "::1"}
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if host not in _local_hosts:
        query.setdefault("sslmode", "require")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
