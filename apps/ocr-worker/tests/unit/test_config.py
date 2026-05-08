from __future__ import annotations

import pytest

from momo_ocr.app.config import load_worker_config, require_production_config


def test_load_worker_config_reads_redis_and_database_urls() -> None:
    config = load_worker_config(
        {
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            "OCR_WORKER_ID": "worker-1",
            "OCR_REDIS_STREAM": "custom-stream",
            "OCR_REDIS_GROUP": "custom-group",
            "OCR_WORKER_CONCURRENCY": "2",
            "IMAGE_TMP_DIR": "/tmp/custom-images",
        }
    )

    assert config.redis_url == "redis://localhost:6379/0"
    assert config.database_url == "postgresql://user:pass@localhost:5432/db"
    assert config.worker_id == "worker-1"
    assert config.redis_stream == "custom-stream"
    assert config.redis_group == "custom-group"
    assert config.concurrency == 2
    assert str(config.temp_root) == "/tmp/custom-images"


def test_require_production_config_rejects_missing_urls() -> None:
    config = load_worker_config({})

    with pytest.raises(ValueError, match="Missing required OCR worker config") as error:
        require_production_config(config)

    assert "REDIS_URL" in str(error.value)
    assert "OCR_DATABASE_URL" in str(error.value)


def test_require_production_config_rejects_unsupported_concurrency() -> None:
    config = load_worker_config(
        {
            "REDIS_URL": "redis://localhost:6379/0",
            "OCR_DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            "OCR_WORKER_CONCURRENCY": "2",
        }
    )

    with pytest.raises(ValueError, match="OCR_WORKER_CONCURRENCY"):
        require_production_config(config)
