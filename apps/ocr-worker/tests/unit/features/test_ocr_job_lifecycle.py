from __future__ import annotations

import pytest

from momo_ocr.features.ocr_jobs.lifecycle import ensure_transition_allowed, is_terminal
from momo_ocr.features.ocr_jobs.models import OcrJobStatus
from momo_ocr.shared.errors import OcrError


def test_lifecycle_allows_queued_to_running() -> None:
    ensure_transition_allowed(OcrJobStatus.QUEUED, OcrJobStatus.RUNNING)


def test_lifecycle_rejects_terminal_reprocessing() -> None:
    with pytest.raises(OcrError) as error:
        ensure_transition_allowed(OcrJobStatus.SUCCEEDED, OcrJobStatus.RUNNING)

    assert error.value.code.value == "DB_WRITE_FAILED"


def test_is_terminal_identifies_terminal_statuses() -> None:
    assert is_terminal(OcrJobStatus.SUCCEEDED)
    assert is_terminal(OcrJobStatus.FAILED)
    assert is_terminal(OcrJobStatus.CANCELLED)
    assert not is_terminal(OcrJobStatus.QUEUED)
