#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from collections.abc import Iterable

SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


def summarize(lines: Iterable[str]) -> dict[str, object]:
    counts: Counter[tuple[str, str, str, str]] = Counter()
    exception_counts: Counter[str] = Counter()
    unstructured = 0
    for line in lines:
        try:
            value = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            unstructured += 1
            continue
        if not isinstance(value, dict):
            unstructured += 1
            continue
        app = _safe(value.get("app"), "unknown")
        component = _safe(value.get("component"), "unknown")
        level = _safe(value.get("level"), "unknown")
        event = _safe(value.get("event"), "none")
        counts[(app, component, level, event)] += 1
        classes = value.get("exception_classes", [])
        if isinstance(classes, list):
            for error_class in classes:
                safe_class = _safe(error_class, "UnknownError")
                exception_counts[safe_class] += 1
    return {
        "schemaVersion": 1,
        "records": [
            {
                "app": key[0],
                "component": key[1],
                "level": key[2],
                "event": key[3],
                "count": count,
            }
            for key, count in sorted(counts.items())
        ],
        "exceptionClasses": dict(sorted(exception_counts.items())),
        "unstructuredLineCount": unstructured,
    }


def _safe(value: object, fallback: str) -> str:
    return value if isinstance(value, str) and SAFE_VALUE.fullmatch(value) else fallback


def main() -> int:
    json.dump(summarize(sys.stdin), sys.stdout, separators=(",", ":"), sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
