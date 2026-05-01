from dataclasses import dataclass, field
from typing import cast

import pytest

from momo_ocr.app.composition import (
    WorkerRuntime,
    _with_sslmode_require,
    text_recognition_engine_from_env,
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
    engine = text_recognition_engine_from_env(None)
    assert isinstance(engine, TesserocrEngine)
    engine.close()


def test_text_recognition_engine_subprocess_override() -> None:
    engine = text_recognition_engine_from_env("subprocess")
    assert isinstance(engine, TesseractEngine)


def test_text_recognition_engine_unknown_value_raises() -> None:
    with pytest.raises(OcrError) as excinfo:
        text_recognition_engine_from_env("paddleocr")
    assert excinfo.value.code is FailureCode.OCR_ENGINE_UNAVAILABLE


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
class _FakeDeps:
    text_engine: object
    consumer: object


def _make_runtime(
    text_engine: object,
    consumer: object,
    pool: object,
) -> WorkerRuntime:
    deps = _FakeDeps(text_engine=text_engine, consumer=consumer)
    return WorkerRuntime(deps=cast("object", deps), pool=cast("object", pool))  # type: ignore[arg-type]


def test_worker_runtime_close_releases_text_engine_consumer_and_pool() -> None:
    text_engine = _RecordingCloseable("engine")
    consumer = _RecordingCloseable("consumer")
    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(text_engine, consumer, pool)

    runtime.close()

    assert text_engine.closes == ["engine"]
    assert consumer.closes == ["consumer"]
    assert pool.closes == ["pool"]


def test_worker_runtime_close_releases_pool_even_if_engine_close_raises() -> None:
    text_engine = _RecordingCloseable("engine", raise_on_close=True)
    consumer = _RecordingCloseable("consumer")
    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(text_engine, consumer, pool)

    runtime.close()

    assert pool.closes == ["pool"]
    assert consumer.closes == ["consumer"]


def test_worker_runtime_close_tolerates_engine_without_close_method() -> None:
    class _EngineWithoutClose:
        pass

    pool = _RecordingCloseable("pool")
    runtime = _make_runtime(_EngineWithoutClose(), _RecordingCloseable("consumer"), pool)

    runtime.close()

    assert pool.closes == ["pool"]
