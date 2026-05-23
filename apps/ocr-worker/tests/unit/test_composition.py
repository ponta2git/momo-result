from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from momo_ocr.app import composition as composition_module
from momo_ocr.app.composition import (
    WorkerRuntime,
    _with_sslmode_require,
    production_worker_runtime,
    redis_consumer_from_config,
)
from momo_ocr.app.config import WorkerConfig
from momo_ocr.features.ocr_jobs.cancellation import InMemoryCancellationChecker
from momo_ocr.features.ocr_jobs.consumer import (
    InMemoryOcrJobConsumer,
    OcrJobConsumer,
    RedisConsumerRetryConfig,
)
from momo_ocr.features.ocr_jobs.dependencies import JobRunnerDependencies
from momo_ocr.features.ocr_jobs.models import OcrQueueDelivery
from momo_ocr.features.ocr_jobs.repository import InMemoryOcrJobRepository
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)
from momo_ocr.features.text_recognition.factory import (
    default_text_recognition_engine,
    text_recognition_engine_from_name,
)
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine
from momo_ocr.shared.errors import FailureCode, OcrError


def test_adds_sslmode_require_for_remote_host() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb"
    result = _with_sslmode_require(url)
    assert "sslmode=require" in result


def test_does_not_add_ssl_for_localhost() -> None:
    url = "postgres://summit:summit@localhost:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_does_not_add_ssl_for_127_0_0_1() -> None:
    url = "postgres://summit:summit@127.0.0.1:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_respects_explicit_sslmode_in_url() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb?sslmode=disable"
    result = _with_sslmode_require(url)
    assert "sslmode=disable" in result
    assert result.count("sslmode=") == 1


def test_text_recognition_engine_default_is_tesserocr() -> None:
    """After Phase C canary parity, the default engine flipped to tesserocr."""
    engine = text_recognition_engine_from_name(None)
    assert isinstance(engine, TesserocrEngine)
    engine.close()


def test_default_text_recognition_engine_does_not_read_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MOMO_OCR_ENGINE", "subprocess")

    engine = default_text_recognition_engine()

    assert isinstance(engine, TesserocrEngine)
    engine.close()


def test_text_recognition_engine_subprocess_override() -> None:
    engine = text_recognition_engine_from_name("subprocess")
    assert isinstance(engine, TesseractEngine)


def test_text_recognition_engine_unknown_value_raises() -> None:
    with pytest.raises(OcrError) as excinfo:
        text_recognition_engine_from_name("paddleocr")
    assert excinfo.value.code is FailureCode.OCR_ENGINE_UNAVAILABLE


def test_production_runtime_validates_queue_contract_before_opening_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def validate_queue_contract_schemas() -> None:
        calls.append("schema")
        raise OcrError(FailureCode.QUEUE_FAILURE, "schema unavailable")

    def production_pool_from_config(_config: WorkerConfig) -> object:
        calls.append("pool")
        return object()

    monkeypatch.setattr(
        composition_module,
        "validate_queue_contract_schemas",
        validate_queue_contract_schemas,
    )
    monkeypatch.setattr(
        composition_module,
        "production_pool_from_config",
        production_pool_from_config,
    )

    with pytest.raises(OcrError):
        production_worker_runtime(
            WorkerConfig(
                database_url="postgres://user:pass@db.example/momo",
                redis_url="redis://example:6379/0",
            )
        )

    assert calls == ["schema"]


def test_redis_consumer_from_config_bounds_redis_socket_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Composition root wires Redis keepalive, periodic PING, and socket bounds.

    Fly.io <-> Upstash NAT silently drops idle TCP sessions, which would
    otherwise leave ``XREADGROUP`` blocking forever on the dead socket.
    """
    captured: dict[str, object] = {}

    class _StubRedis:
        @classmethod
        def from_url(cls, url: str, **kwargs: object) -> _StubRedis:
            captured["url"] = url
            captured.update(kwargs)
            return cls()

        def xgroup_create(
            self,
            _name: object,
            _groupname: object,
            _stream_id: object,
            /,
            *,
            mkstream: bool,
        ) -> None:
            captured["mkstream"] = mkstream

    monkeypatch.setattr(composition_module, "Redis", _StubRedis)

    config = WorkerConfig(redis_url="redis://example:6379/0", worker_id="w-1")
    redis_consumer_from_config(config)

    assert captured["url"] == "redis://example:6379/0"
    assert captured["decode_responses"] is True
    assert captured["health_check_interval"] == 30
    assert captured["socket_keepalive"] is True
    assert captured["socket_connect_timeout"] == 5.0
    assert captured["socket_timeout"] == 35.0
    assert captured["mkstream"] is True


def test_redis_consumer_from_config_uses_independent_claim_idle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _StubRedis:
        @classmethod
        def from_url(cls, url: str, **kwargs: object) -> _StubRedis:
            del url, kwargs
            return cls()

    class _StubConsumer:
        def __init__(
            self,
            _client: object,
            *,
            stream: str,
            group: str,
            consumer_name: str,
            block_ms: int,
            retry_config: RedisConsumerRetryConfig,
        ) -> None:
            del stream, group, consumer_name
            captured["block_ms"] = block_ms
            captured["claim_idle_ms"] = retry_config.claim_idle_ms

    monkeypatch.setattr(composition_module, "Redis", _StubRedis)
    monkeypatch.setattr(composition_module, "RedisOcrJobConsumer", _StubConsumer)

    config = WorkerConfig(
        redis_url="redis://example:6379/0",
        worker_id="w-1",
        ocr_timeout_seconds=30,
        redis_claim_idle_seconds=450,
    )
    redis_consumer_from_config(config)

    assert captured["claim_idle_ms"] == 450_000
    assert captured["block_ms"] == 30_000


@dataclass
class _RecordingCloseable:
    name: str
    closes: list[str] = field(default_factory=list)
    raise_on_close: bool = False

    def close(self) -> None:
        self.closes.append(self.name)
        if self.raise_on_close:
            msg = "boom"
            raise RuntimeError(msg)


@dataclass
class _RecordingConsumer:
    name: str
    closes: list[str] = field(default_factory=list)
    raise_on_close: bool = False

    def pull(self) -> OcrQueueDelivery | None:
        return None

    def ack(self, delivery_tag: str) -> None:
        del delivery_tag

    def close(self) -> None:
        self.closes.append(self.name)
        if self.raise_on_close:
            msg = "boom"
            raise RuntimeError(msg)


class _RecordingTextEngine(FakeTextRecognitionEngine):
    def __init__(self, name: str, *, raise_on_close: bool = False) -> None:
        super().__init__()
        self.name = name
        self.closes: list[str] = []
        self.raise_on_close = raise_on_close

    def close(self) -> None:
        self.closes.append(self.name)
        if self.raise_on_close:
            msg = "boom"
            raise RuntimeError(msg)


def _make_runtime(
    text_engine: TextRecognitionEngine,
    consumer: OcrJobConsumer,
    pool: _RecordingCloseable,
) -> WorkerRuntime:
    deps = JobRunnerDependencies(
        consumer=consumer,
        repository=InMemoryOcrJobRepository(),
        cancellation=InMemoryCancellationChecker(),
        worker_id="worker-test",
        text_engine=text_engine,
    )
    return WorkerRuntime(deps=deps, pool=pool)


def test_worker_runtime_close_releases_text_engine_consumer_and_pool() -> None:
    text_engine = _RecordingTextEngine("engine")
    consumer = _RecordingConsumer("consumer")
    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(text_engine, consumer, pool)

    runtime.close()

    assert text_engine.closes == ["engine"]
    assert consumer.closes == ["consumer"]
    assert pool.closes == ["pool"]


def test_worker_runtime_close_releases_pool_even_if_engine_close_raises() -> None:
    text_engine = _RecordingTextEngine("engine", raise_on_close=True)
    consumer = _RecordingConsumer("consumer")
    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(text_engine, consumer, pool)

    runtime.close()

    assert pool.closes == ["pool"]
    assert consumer.closes == ["consumer"]


def test_worker_runtime_close_tolerates_engine_without_close_method() -> None:
    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(
        FakeTextRecognitionEngine(),
        InMemoryOcrJobConsumer(),
        pool,
    )

    runtime.close()

    assert pool.closes == ["pool"]
