from __future__ import annotations

from uuid import UUID

import pytest

from momo_ocr.shared import ids


def test_new_id_returns_uuid4_string(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = UUID("12345678-1234-4567-9234-123456789abc")
    monkeypatch.setattr(ids, "uuid4", lambda: expected)

    assert ids.new_id() == "12345678-1234-4567-9234-123456789abc"
