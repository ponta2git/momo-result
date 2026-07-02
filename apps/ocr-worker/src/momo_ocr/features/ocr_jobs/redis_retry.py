from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RedisConsumerRetryConfig:
    max_attempts: int
    dead_letter_stream: str | None
    claim_idle_ms: int
    pending_scan_count: int

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            msg = "max_attempts must be a positive integer."
            raise ValueError(msg)
        if self.claim_idle_ms < 1:
            msg = "claim_idle_ms must be a positive integer."
            raise ValueError(msg)
        if self.pending_scan_count < 1:
            msg = "pending_scan_count must be a positive integer."
            raise ValueError(msg)


DEFAULT_REDIS_RETRY_CONFIG = RedisConsumerRetryConfig(
    max_attempts=1,
    dead_letter_stream=None,
    claim_idle_ms=30_000,
    pending_scan_count=10,
)
