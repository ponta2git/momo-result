"""Aggregate per-image evaluation records into accuracy + latency summary."""

from __future__ import annotations

from typing import Any

from eval_lib.types import ImageEval


def percentile(values: list[float], p: float) -> float | None:
    """Return the linear-interpolated p-th percentile (0..100) of ``values``."""
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def aggregate(records: list[ImageEval]) -> dict[str, Any]:
    total = sum(r.field_total for r in records)
    correct = sum(r.field_correct for r in records)
    by_screen: dict[str, dict[str, int]] = {}
    for r in records:
        bucket = by_screen.setdefault(r.screen_type, {"total": 0, "correct": 0, "images": 0})
        bucket["total"] += r.field_total
        bucket["correct"] += r.field_correct
        bucket["images"] += 1

    durations = [r.duration_ms_mean for r in records]
    player_order = _aggregate_player_order(records)
    return {
        "images": len(records),
        "fields_total": total,
        "fields_correct": correct,
        "accuracy": (correct / total) if total else None,
        "by_screen_type": {
            stype: {
                **stats,
                "accuracy": (stats["correct"] / stats["total"] if stats["total"] else None),
            }
            for stype, stats in by_screen.items()
        },
        "duration_ms": {
            "sum_mean": sum(durations),
            "min": min(durations) if durations else None,
            "max": max(durations) if durations else None,
            "mean": (sum(durations) / len(durations)) if durations else None,
            "p50": percentile(durations, 50),
            "p95": percentile(durations, 95),
            "p99": percentile(durations, 99),
        },
        "player_order": player_order,
        "failures": [r.file for r in records if r.failure is not None or r.field_total == 0],
    }


def _aggregate_player_order(records: list[ImageEval]) -> dict[str, Any]:
    totals = {
        "direct_total": 0,
        "direct_matches": 0,
        "fallback_name_matches": 0,
        "unresolved_players": 0,
    }
    for record in records:
        stats = record.diagnostics.get("player_order", {})
        for key in totals:
            totals[key] += int(stats.get(key) or 0)
    direct_total = totals["direct_total"]
    return {
        **totals,
        "direct_accuracy": (totals["direct_matches"] / direct_total if direct_total else None),
    }
