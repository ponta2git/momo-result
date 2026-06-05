from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from momo_ocr.app.composition import _redis_socket_timeout_seconds
from momo_ocr.app.config import (
    DEFAULT_REDIS_DEAD_LETTER_STREAM,
    DEFAULT_REDIS_GROUP,
    DEFAULT_REDIS_STREAM,
    load_worker_config,
    require_production_config,
)


def test_load_worker_config_reads_redis_and_database_urls() -> None:
    config = load_worker_config(
        {
            "APP_ENV": "dev",
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            "OCR_WORKER_ID": "worker-1",
            "OCR_REDIS_STREAM": "custom-stream",
            "OCR_REDIS_GROUP": "custom-group",
            "OCR_WORKER_CONCURRENCY": "2",
            "OCR_REDIS_CLAIM_IDLE_SECONDS": "450",
            "OCR_REDIS_BLOCK_SECONDS": "45",
            "IMAGE_TMP_DIR": "/tmp/custom-images",
            "MOMO_OCR_FAST_PATH": "yes",
            "MOMO_OCR_DEBUG_DIR": "/tmp/ocr-debug",
            "MOMO_OCR_ENGINE": "subprocess",
        }
    )

    assert config.redis_url == "redis://localhost:6379/0"
    assert config.redis_allow_plaintext_in_prod is False
    assert config.app_env == "dev"
    assert config.database_url == "postgresql://user:pass@localhost:5432/db"
    assert config.worker_id == "worker-1"
    assert config.redis_stream == "custom-stream"
    assert config.redis_group == "custom-group"
    assert config.concurrency == 2
    assert config.redis_claim_idle_seconds == 450
    assert config.redis_block_seconds == 45
    assert str(config.temp_root) == "/tmp/custom-images"
    assert config.fast_path_enabled is True
    assert config.debug_dir_base is not None
    assert str(config.debug_dir_base) == "/tmp/ocr-debug"
    assert config.ocr_engine == "subprocess"
    assert _redis_socket_timeout_seconds(config) == 50.0


def test_load_worker_config_expands_temp_root_home(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    config = load_worker_config({"IMAGE_TMP_DIR": "~/momo-images"})

    assert config.temp_root == home / "momo-images"


def test_require_production_config_rejects_missing_urls() -> None:
    config = load_worker_config({})

    with pytest.raises(ValueError, match="Missing required OCR worker config") as error:
        require_production_config(config)

    assert "REDIS_URL" in str(error.value)
    assert "OCR_DATABASE_URL" in str(error.value)


def test_load_worker_config_rejects_unknown_app_env() -> None:
    with pytest.raises(ValueError, match="APP_ENV must be one of"):
        load_worker_config({"APP_ENV": "production"})


def test_load_worker_config_ignores_blank_redis_identity_overrides() -> None:
    config = load_worker_config(
        {
            "OCR_WORKER_ID": "",
            "OCR_REDIS_STREAM": "",
            "OCR_REDIS_GROUP": "",
            "OCR_REDIS_DEAD_LETTER_STREAM": "",
        }
    )

    assert config.worker_id
    assert config.redis_stream == DEFAULT_REDIS_STREAM
    assert config.redis_group == DEFAULT_REDIS_GROUP
    assert config.redis_dead_letter_stream == DEFAULT_REDIS_DEAD_LETTER_STREAM


def test_require_production_config_rejects_unknown_app_env() -> None:
    config = load_worker_config(
        {
            "REDIS_URL": "rediss://redis.example.com:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@db.example.com/db",
        }
    )

    with pytest.raises(ValueError, match="APP_ENV must be one of"):
        require_production_config(replace(config, app_env="production"))


def test_require_production_config_allows_configured_concurrency() -> None:
    config = load_worker_config(
        {
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            "OCR_WORKER_CONCURRENCY": "2",
        }
    )

    require_production_config(config)


def test_require_production_config_rejects_insecure_redis_url_in_prod() -> None:
    config = load_worker_config(
        {
            "APP_ENV": "prod",
            "REDIS_URL": "redis://redis.example.com:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@db.example.com/db",
        }
    )

    with pytest.raises(ValueError, match="REDIS_URL must use rediss://"):
        require_production_config(config)


def test_require_production_config_allows_plaintext_redis_in_prod_when_explicit() -> None:
    config = load_worker_config(
        {
            "APP_ENV": "prod",
            "REDIS_URL": "redis://redis.example.com:6379/0",
            "REDIS_ALLOW_PLAINTEXT_IN_PROD": "true",
            "OCR_DATABASE_URL": "postgresql://user:pass@db.example.com/db",
        }
    )

    require_production_config(config)
    assert config.redis_allow_plaintext_in_prod is True


def test_load_worker_config_rejects_malformed_plaintext_redis_override() -> None:
    with pytest.raises(ValueError, match="REDIS_ALLOW_PLAINTEXT_IN_PROD"):
        load_worker_config(
            {
                "APP_ENV": "prod",
                "REDIS_URL": "redis://redis.example.com:6379/0",
                "REDIS_ALLOW_PLAINTEXT_IN_PROD": "maybe",
                "OCR_DATABASE_URL": "postgresql://user:pass@db.example.com/db",
            }
        )


def test_require_production_config_allows_local_redis_url_outside_prod() -> None:
    config = load_worker_config(
        {
            "APP_ENV": "dev",
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
        }
    )

    require_production_config(config)
