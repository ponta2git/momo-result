from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from momo_ocr.features.ocr_jobs.models import OcrQueueDelivery
from momo_ocr.shared.errors import OcrFailure


class OcrJobConsumer(Protocol):  # pragma: no cover
    """Pull-based consumer of OCR job deliveries."""

    def pull(self) -> OcrQueueDelivery | None:
        raise NotImplementedError

    def ack(self, delivery_tag: str) -> None:
        raise NotImplementedError

    def dead_letter(
        self,
        delivery_tag: str,
        raw_fields: Mapping[str, str],
        *,
        failure: OcrFailure,
        deliveries: int,
    ) -> None:
        raise NotImplementedError
