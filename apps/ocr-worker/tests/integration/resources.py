from __future__ import annotations

import os
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class OcrJobIds:
    job_id: str
    draft_id: str
    image_id: str
    image_path: str


@dataclass(frozen=True)
class RedisNames:
    stream: str
    group: str
    consumer: str


def resource_suffix(node_id: str) -> str:
    worker = os.environ.get("PYTEST_XDIST_WORKER", "local")
    raw = f"{worker}-{node_id}"
    suffix = re.sub(r"[^a-zA-Z0-9]+", "-", raw).strip("-").lower()
    return suffix or "test"
