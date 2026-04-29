from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from time import perf_counter


@contextmanager
def record_duration_ms(timings: dict[str, float], name: str) -> Iterator[None]:
    start = perf_counter()
    try:
        yield
    finally:
        timings[name] = round((perf_counter() - start) * 1000, 3)
