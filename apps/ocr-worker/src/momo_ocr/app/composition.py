from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from psycopg_pool import ConnectionPool

from momo_ocr.app.config import WorkerConfig, require_production_config
from momo_ocr.features.ocr_jobs.cancellation import RepositoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import RedisOcrJobConsumer
from momo_ocr.features.ocr_jobs.repository import PostgresOcrJobRepository
from momo_ocr.features.ocr_jobs.result_writer import PostgresOcrResultWriter
from momo_ocr.features.text_recognition.factory import default_text_recognition_engine

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies


logger = logging.getLogger(__name__)


def redis_consumer_from_config(config: WorkerConfig) -> RedisOcrJobConsumer:
    return RedisOcrJobConsumer.from_config(config)


# Pool sizing: a single worker process serializes job processing, so 1 active
# connection covers steady-state. `max_size=2` leaves headroom for the
# cancellation poll path that may fire concurrently with the runner. Neon's
# pooler handles further multiplexing on the server side, so keeping our
# client pool small is a feature, not a limitation.
_POOL_MIN_SIZE = 1
_POOL_MAX_SIZE = 2
# Neon scales compute to zero when idle. Closing idle conns aggressively
# avoids "stale connection" surprises on cold-start without paying TLS
# handshake cost on every job.
_POOL_MAX_IDLE_SECONDS = 60.0


def production_pool_from_config(config: WorkerConfig) -> ConnectionPool:
    if config.database_url is None:
        msg = "OCR_DATABASE_URL or DATABASE_URL is required for the Postgres connection pool."
        raise ValueError(msg)
    conninfo = _with_sslmode_require(config.database_url)
    return ConnectionPool(
        conninfo,
        min_size=_POOL_MIN_SIZE,
        max_size=_POOL_MAX_SIZE,
        max_idle=_POOL_MAX_IDLE_SECONDS,
        # Open eagerly so a misconfigured DSN fails fast at startup, not on
        # the first delivered job.
        open=True,
    )


@dataclass(frozen=True)
class WorkerRuntime:
    """Process-wide resources backing one worker run.

    Owns the lifecycle of pool + consumer + text engine; `close()` is
    idempotent and safe to call from a `finally` block. The pool is
    shared between repository and writer so a job uses a single warm
    connection across its 5–6 state transitions instead of opening one
    per call. The text engine caches PyTessBaseAPI handles and must be
    `End()`-ed at shutdown to release Tesseract's native resources
    deterministically (otherwise we leak them until interpreter exit).
    """

    deps: JobRunnerDependencies
    pool: ConnectionPool

    def close(self) -> None:
        # Close in reverse order of acquisition: text engine (per-process
        # native handles) → consumer (Redis socket) → DB pool. Each step
        # is wrapped so a failure in one resource still releases the
        # others; otherwise a flaky shutdown could leak Postgres
        # connections that count against Neon's tenant cap.
        for closeable in (self.deps.text_engine, self.deps.consumer):
            close_fn = getattr(closeable, "close", None)
            if not callable(close_fn):
                continue
            try:
                close_fn()
            except Exception:
                logger.exception(
                    "Failed to close worker resource cleanly; continuing shutdown.",
                    extra={"resource": type(closeable).__name__},
                )
        self.pool.close()


def production_worker_runtime(config: WorkerConfig) -> WorkerRuntime:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies  # noqa: PLC0415

    require_production_config(config)
    pool = production_pool_from_config(config)
    try:
        consumer = redis_consumer_from_config(config)
        repository = PostgresOcrJobRepository(pool)
        writer = PostgresOcrResultWriter(pool)
        # Construct one TesseractEngine for the entire worker process so we
        # pay shutil.which() and field-config setup exactly once. The runner
        # then re-uses this instance for every job.
        text_engine = default_text_recognition_engine()
        deps = JobRunnerDependencies(
            consumer=consumer,
            repository=repository,
            result_writer=writer,
            cancellation=RepositoryCancellationChecker(repository),
            worker_id=config.worker_id,
            text_engine=text_engine,
        )
    except BaseException:
        # If anything between pool creation and runtime assembly fails we
        # must release the eagerly-opened pool so the process exits cleanly.
        pool.close()
        raise
    return WorkerRuntime(deps=deps, pool=pool)


def _with_sslmode_require(database_url: str) -> str:
    """Add sslmode=require unless the host is localhost/127.0.0.1 (local dev)."""
    parts = urlsplit(database_url)
    host = parts.hostname or ""
    _local_hosts = {"localhost", "127.0.0.1", "::1"}
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if host not in _local_hosts:
        query.setdefault("sslmode", "require")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
