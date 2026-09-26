#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Metric:
    pct: float | None
    covered: int | None = None
    total: int | None = None

    def __post_init__(self) -> None:
        if self.pct is not None and (
            type(self.pct) not in (int, float)
            or not 0 <= self.pct <= 100
            or not math.isfinite(self.pct)
        ):
            raise ValueError("Coverage percentage must be a finite number from 0 to 100.")
        if self.covered is None and self.total is None:
            return
        if type(self.covered) is not int or type(self.total) is not int:
            raise ValueError("Coverage counts must be integers.")
        if not 0 <= self.covered <= self.total:
            raise ValueError("Coverage counts must satisfy 0 <= covered <= total.")
        if self.total == 0 and self.pct not in (None, 0, 100):
            raise ValueError("Empty coverage must be unknown, 0%, or 100%.")
        if self.total > 0:
            # Istanbul truncates and scoverage rounds percentages to two decimals.
            if self.pct is None or not math.isclose(
                self.pct, 100 * self.covered / self.total, abs_tol=0.01
            ):
                raise ValueError("Coverage percentage does not match its counts.")

    @property
    def rounded_pct(self) -> float | None:
        if self.covered is not None and self.total:
            return round(100 * self.covered / self.total, 1)
        return round(self.pct, 1) if self.pct is not None else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Write normalized coverage summaries for CI.")
    parser.add_argument("subsystem", choices=["web", "api"])
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    exit_status = 0
    try:
        source_reports, metrics = read_metrics(root, args.subsystem)
        status = "ok"
        message = None
    except FileNotFoundError as error:
        source_reports = []
        metrics = {}
        status = "missing"
        message = str(error)
        exit_status = 0 if args.allow_missing else 1
    except (ValueError, TypeError, KeyError, ET.ParseError) as error:
        source_reports = []
        metrics = {}
        status = "invalid"
        message = f"Invalid coverage report: {error}"
        exit_status = 1

    raw_summary = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "subsystem": args.subsystem,
        "status": status,
        "message": message,
        "sourceReports": [relative_to_or_absolute(path, root) for path in source_reports],
        "metrics": {
            name: {
                "pct": metric.rounded_pct,
                "covered": metric.covered,
                "total": metric.total,
            }
            for name, metric in metrics.items()
        },
    }

    write_json(out_dir / "raw-summary.json", raw_summary)
    (out_dir / "summary.md").write_text(render_markdown(raw_summary), encoding="utf-8")
    if exit_status:
        print(message, file=sys.stderr)
    return exit_status


def read_metrics(root: Path, subsystem: str) -> tuple[list[Path], dict[str, Metric]]:
    if subsystem == "web":
        return read_web_metrics(root)
    if subsystem == "api":
        return read_api_metrics(root)
    raise ValueError(f"Unsupported subsystem: {subsystem}")


def read_web_metrics(root: Path) -> tuple[list[Path], dict[str, Metric]]:
    report = root / "apps/web/coverage/coverage-summary.json"
    data = read_json(report)
    total = data["total"]
    return [report], {
        "statements": istanbul_metric(total["statements"]),
        "branches": istanbul_metric(total["branches"]),
        "functions": istanbul_metric(total["functions"]),
        "lines": istanbul_metric(total["lines"]),
    }


def read_api_metrics(root: Path) -> tuple[list[Path], dict[str, Metric]]:
    scoverage_report = find_scala_report(root, "scoverage-report/scoverage.xml")
    scoverage = ET.parse(scoverage_report).getroot()
    if scoverage.tag != "scoverage":
        raise ValueError("Expected an scoverage XML report.")

    # Scoverage measures statements and branches, not lines. Its Cobertura export
    # labels statement counts as lines; it is not an independent line metric.
    metrics = {
        "statements": Metric(
            pct=float(scoverage.attrib["statement-rate"]),
            covered=int(scoverage.attrib["statements-invoked"]),
            total=int(scoverage.attrib["statement-count"]),
        ),
        "branches": Metric(pct=float(scoverage.attrib["branch-rate"])),
    }
    return [scoverage_report], metrics


def find_scala_report(root: Path, relative_report: str) -> Path:
    scala_target = root / "apps/api/target"
    candidates = sorted(scala_target.glob(f"scala-*/{relative_report}"))
    if not candidates:
        raise FileNotFoundError(f"Coverage report not found under {scala_target}: {relative_report}")
    if len(candidates) != 1:
        raise ValueError(f"Ambiguous Scala coverage reports: {', '.join(map(str, candidates))}")
    return candidates[0]


def istanbul_metric(value: dict[str, Any]) -> Metric:
    pct = value["pct"]
    if pct == "Unknown" and value["covered"] == 0 and value["total"] == 0:
        return Metric(pct=None, covered=value["covered"], total=value["total"])
    if type(pct) not in (int, float):
        raise ValueError("Expected an Istanbul percentage or an empty Unknown metric.")
    return Metric(pct=pct, covered=value["covered"], total=value["total"])


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Coverage report not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def render_markdown(summary: dict[str, Any]) -> str:
    title = f"## Coverage Summary: {summary['subsystem']}"
    if summary["status"] != "ok":
        return f"{title}\n\nCoverage report is unavailable: {summary['message']}\n"

    lines = [
        title,
        "",
        "| Metric | Coverage | Covered / Total |",
        "|---|---:|---:|",
    ]
    for name, metric in summary["metrics"].items():
        covered = metric["covered"]
        total = metric["total"]
        covered_total = "-" if covered is None or total is None else f"{covered} / {total}"
        percentage = "-" if metric["pct"] is None else f"{metric['pct']:.1f}%"
        lines.append(
            f"| {name} | {percentage} | {covered_total} |"
        )
    lines.append("")
    return "\n".join(lines)


def relative_to_or_absolute(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


if __name__ == "__main__":
    sys.exit(main())
