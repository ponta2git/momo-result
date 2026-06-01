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
    pct: float
    covered: int | None = None
    total: int | None = None


def main() -> int:
    parser = argparse.ArgumentParser(description="Write normalized coverage summaries for CI.")
    parser.add_argument("subsystem", choices=["web", "api", "ocr-worker"])
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        source_reports, metrics = read_metrics(root, args.subsystem)
        status = "ok"
        message = None
    except FileNotFoundError as error:
        if not args.allow_missing:
            raise
        source_reports = []
        metrics = {}
        status = "missing"
        message = str(error)

    raw_summary = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "subsystem": args.subsystem,
        "status": status,
        "message": message,
        "sourceReports": [relative_to_or_absolute(path, root) for path in source_reports],
        "metrics": {
            name: {
                "pct": round(metric.pct, 1),
                "covered": metric.covered,
                "total": metric.total,
                "roundedBaseline": rounded_baseline(metric.pct),
            }
            for name, metric in metrics.items()
        },
    }
    rounded_summary = {
        "generatedAt": raw_summary["generatedAt"],
        "subsystem": args.subsystem,
        "status": status,
        "metrics": {
            name: value["roundedBaseline"] for name, value in raw_summary["metrics"].items()
        },
    }

    write_json(out_dir / "raw-summary.json", raw_summary)
    write_json(out_dir / "rounded-baseline.json", rounded_summary)
    (out_dir / "summary.md").write_text(render_markdown(raw_summary), encoding="utf-8")
    return 0


def read_metrics(root: Path, subsystem: str) -> tuple[list[Path], dict[str, Metric]]:
    if subsystem == "web":
        return read_web_metrics(root)
    if subsystem == "api":
        return read_api_metrics(root)
    if subsystem == "ocr-worker":
        return read_ocr_worker_metrics(root)
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
    cobertura_report = find_scala_report(root, "coverage-report/cobertura.xml")
    scoverage = ET.parse(scoverage_report).getroot()
    cobertura = ET.parse(cobertura_report).getroot()

    metrics = {
        "statements": Metric(
            pct=float(scoverage.attrib["statement-rate"]),
            covered=int(scoverage.attrib["statements-invoked"]),
            total=int(scoverage.attrib["statement-count"]),
        ),
        "branches": Metric(
            pct=float(scoverage.attrib["branch-rate"]),
            covered=int(cobertura.attrib["branches-covered"]),
            total=int(cobertura.attrib["branches-valid"]),
        ),
        "lines": Metric(
            pct=float(cobertura.attrib["line-rate"]) * 100,
            covered=int(cobertura.attrib["lines-covered"]),
            total=int(cobertura.attrib["lines-valid"]),
        ),
    }
    return [scoverage_report, cobertura_report], metrics


def read_ocr_worker_metrics(root: Path) -> tuple[list[Path], dict[str, Metric]]:
    report = root / "apps/ocr-worker/coverage.json"
    data = read_json(report)
    totals = data["totals"]

    metrics = {
        "total": Metric(pct=float(totals["percent_covered"])),
        "lines": Metric(
            pct=ratio_pct(totals["covered_lines"], totals["num_statements"]),
            covered=int(totals["covered_lines"]),
            total=int(totals["num_statements"]),
        ),
    }
    branch_total = int(totals.get("num_branches", 0))
    if branch_total > 0:
        metrics["branches"] = Metric(
            pct=ratio_pct(totals["covered_branches"], branch_total),
            covered=int(totals["covered_branches"]),
            total=branch_total,
        )

    return [report], metrics


def find_scala_report(root: Path, relative_report: str) -> Path:
    scala_target = root / "apps/api/target"
    candidates = sorted(scala_target.glob(f"scala-*/{relative_report}"))
    if not candidates:
        raise FileNotFoundError(f"Coverage report not found under {scala_target}: {relative_report}")
    return candidates[-1]


def istanbul_metric(value: dict[str, Any]) -> Metric:
    return Metric(pct=float(value["pct"]), covered=int(value["covered"]), total=int(value["total"]))


def ratio_pct(covered: Any, total: Any) -> float:
    total_int = int(total)
    if total_int == 0:
        return 100.0
    return int(covered) / total_int * 100


def rounded_baseline(pct: float) -> int:
    if pct >= 99.5:
        return 100
    return int(math.floor(pct / 5) * 5)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Coverage report not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render_markdown(summary: dict[str, Any]) -> str:
    title = f"## Coverage Summary: {summary['subsystem']}"
    if summary["status"] != "ok":
        return f"{title}\n\nCoverage report is unavailable: {summary['message']}\n"

    lines = [
        title,
        "",
        "| Metric | Raw | Rounded baseline candidate | Covered / Total |",
        "|---|---:|---:|---:|",
    ]
    for name, metric in summary["metrics"].items():
        covered = metric["covered"]
        total = metric["total"]
        covered_total = "-" if covered is None or total is None else f"{covered} / {total}"
        lines.append(
            f"| {name} | {metric['pct']:.1f}% | {metric['roundedBaseline']}% | {covered_total} |"
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
