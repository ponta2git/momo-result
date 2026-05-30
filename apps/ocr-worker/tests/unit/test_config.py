from __future__ import annotations

import pytest

from momo_ocr.app.composition import _redis_socket_timeout_seconds
from momo_ocr.app.config import load_worker_config, require_production_config


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


def test_require_production_config_rejects_missing_urls() -> None:
    config = load_worker_config({})

    with pytest.raises(ValueError, match="Missing required OCR worker config") as error:
        require_production_config(config)

    assert "REDIS_URL" in str(error.value)
    assert "OCR_DATABASE_URL" in str(error.value)


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


def test_require_production_config_allows_local_redis_url_outside_prod() -> None:
    config = load_worker_config(
        {
            "APP_ENV": "dev",
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
        }
    )

    require_production_config(config)
