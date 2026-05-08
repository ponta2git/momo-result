"""Queue delivery acknowledgement helpers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from momo_ocr.features.ocr_jobs.models import MalformedPulledJob, PulledJob

if TYPE_CHECKING:
    from momo_ocr.features.ocr_jobs.runner import JobRunnerDependencies

logger = logging.getLogger(__name__)


def ack_delivery(deps: JobRunnerDependencies, delivery: PulledJob | MalformedPulledJob) -> None:
    """Best-effort ack. Failures are logged so the broker controls redelivery."""
    try:
        deps.consumer.ack(delivery.delivery_tag)
    except Exception:
        job_id = (
            delivery.message.job_id
            if isinstance(delivery, PulledJob)
            else delivery.raw_fields.get("jobId")
        )
        logger.exception(
            "Failed to acknowledge OCR queue delivery; broker will redeliver",
            extra={
                "job_id": job_id,
                "delivery_tag": delivery.delivery_tag,
            },
        )
