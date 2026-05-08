#!/usr/bin/env python3
"""Run deterministic 桃鉄2 OCR accuracy analysis for momo-result."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SAMPLES_REL = Path("ocr_samples/003_桃鉄2")
EVAL_REL = Path("apps/ocr-worker/scripts/eval_accuracy.py")
OUT_REL = Path("apps/ocr-worker/out/ocr-accuracy-analysis")
SHEET_EXPORT_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1QDjwF2R5F7qBhr2peJlrX7SWnOe9sUAfWRcerostXCs/"
    "export?format=tsv&gid=1945192774"
)
ANSWER_CANDIDATES = ("answers.tsv", "answer.tsv")
REQUIRED_COLUMNS = (
    "対戦No.",
    "プレー順",
    "プレーヤー名",
    "順位",
    "総資産",
    "収益",
    "目的地",
    "プラス駅",
    "マイナス駅",
    "カード駅",
    "カード売り場",
    "スリの銀次",
)
FILENAME_RE = re.compile(
    r"^[^_]+_(?P<match>\d+)_(?P<date>\d{8})_(?P<map>[^_]+)_"
    r"(?P<prefix>0[123])(?P<slot>[^_.]+)(?:_(?P<comment>[^.]+))?\."
    r"(?P<ext>jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)
INCIDENT_LOG_LOW_CONFIDENCE_THRESHOLD = 0.2
MAX_INCIDENT_LOG_QUALITY_EXAMPLES = 12


@dataclass(frozen=True)
class SampleFile:
    path: Path
    match_no: int
    prefix: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run OCR accuracy analysis for ocr_samples/003_桃鉄2."
    )
    parser.add_argument(
        "match_no",
        nargs="?",
        type=int,
        help="Optional 対戦No. to analyze. Omit to analyze all files.",
    )
    parser.add_argument("--mode", choices=("debug", "timing"), default="debug")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--debug-dir", type=Path)
    parser.add_argument("--summary-only", action="store_true")
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Only resolve targets and ensure answers.tsv; do not run OCR.",
    )
    parser.add_argument(
        "--no-fetch",
        action="store_true",
        help="Fail instead of fetching Google Sheets TSV when answer rows are missing.",
    )
    return parser.parse_args()


def find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "AGENTS.md").is_file() and (parent / EVAL_REL).is_file():
            return parent
    raise SystemExit("Could not locate momo-result repository root.")


def read_tsv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        return [], []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        if reader.fieldnames is None:
            return [], []
        return list(reader.fieldnames), [dict(row) for row in reader]


def write_tsv(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=header,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="ignore",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in header})


def int_cell(row: dict[str, str], column: str) -> int | None:
    value = row.get(column, "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def row_key(row: dict[str, str]) -> tuple[int, int] | None:
    match_no = int_cell(row, "対戦No.")
    play_order = int_cell(row, "プレー順")
    if match_no is None or play_order is None:
        return None
    return match_no, play_order


def validate_header(header: list[str], *, path: Path) -> None:
    missing = [col for col in REQUIRED_COLUMNS if col not in header]
    if missing:
        raise SystemExit(f"{path} is missing required columns: {', '.join(missing)}")


def select_samples(samples_dir: Path, match_no: int | None) -> list[SampleFile]:
    if not samples_dir.is_dir():
        raise SystemExit(f"samples directory does not exist: {samples_dir}")
    samples: list[SampleFile] = []
    for path in sorted(samples_dir.iterdir()):
        if not path.is_file():
            continue
        match = FILENAME_RE.match(path.name)
        if match is None:
            continue
        sample = SampleFile(
            path=path,
            match_no=int(match.group("match")),
            prefix=match.group("prefix"),
        )
        if match_no is not None and sample.match_no != match_no:
            continue
        samples.append(sample)
    samples.sort(key=lambda s: (s.match_no, s.prefix, s.path.name))
    if not samples:
        scope = f"match {match_no}" if match_no is not None else "all files"
        raise SystemExit(f"no target sample images found for {scope}")
    return samples


def answer_path(samples_dir: Path) -> Path:
    for name in ANSWER_CANDIDATES:
        candidate = samples_dir / name
        if candidate.is_file():
            return candidate
    return samples_dir / "answers.tsv"


def required_match_numbers(samples: list[SampleFile]) -> set[int]:
    return {sample.match_no for sample in samples}


def complete_match_numbers(rows: list[dict[str, str]]) -> set[int]:
    play_orders_by_match: dict[int, set[int]] = defaultdict(set)
    for row in rows:
        key = row_key(row)
        if key is not None:
            match_no, play_order = key
            play_orders_by_match[match_no].add(play_order)
    return {
        match_no
        for match_no, play_orders in play_orders_by_match.items()
        if len(play_orders) >= 4
    }


def fetch_sheet_rows() -> tuple[list[str], list[dict[str, str]]]:
    with urllib.request.urlopen(SHEET_EXPORT_URL, timeout=30) as response:
        raw = response.read()
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines(), delimiter="\t")
    if reader.fieldnames is None:
        raise SystemExit("downloaded Google Sheet TSV has no header")
    header = list(reader.fieldnames)
    validate_header(header, path=Path("Google Sheet export"))
    return header, [dict(row) for row in reader]


def ensure_answers(
    *,
    answers: Path,
    needed_matches: set[int],
    no_fetch: bool,
) -> dict[str, Any]:
    local_header, local_rows = read_tsv(answers)
    if local_header:
        validate_header(local_header, path=answers)
    local_complete = complete_match_numbers(local_rows)
    missing_matches = sorted(needed_matches - local_complete)
    if not missing_matches:
        return {
            "answers_path": str(answers),
            "downloaded": False,
            "appended_rows": 0,
            "missing_matches": [],
        }
    if no_fetch:
        raise SystemExit(
            "answer rows are missing and --no-fetch was set: "
            + ", ".join(str(n) for n in missing_matches)
        )

    source_header, source_rows = fetch_sheet_rows()
    header = local_header or source_header
    validate_header(
        header, path=answers if local_header else Path("Google Sheet export")
    )

    existing_keys = {key for row in local_rows if (key := row_key(row)) is not None}
    rows_to_append = [
        row
        for row in source_rows
        if (key := row_key(row)) is not None
        and key[0] in missing_matches
        and key not in existing_keys
    ]
    found_complete = complete_match_numbers(local_rows + rows_to_append)
    still_missing = sorted(needed_matches - found_complete)
    if still_missing:
        raise SystemExit(
            "Google Sheet export did not provide complete answer rows for: "
            + ", ".join(str(n) for n in still_missing)
        )

    write_tsv(answers, header, local_rows + rows_to_append)
    return {
        "answers_path": str(answers),
        "downloaded": True,
        "appended_rows": len(rows_to_append),
        "missing_matches": missing_matches,
        "source_url": SHEET_EXPORT_URL,
    }


def default_paths(root: Path, match_no: int | None) -> tuple[Path, Path, str]:
    scope = "all" if match_no is None else f"match-{match_no:03d}"
    out_dir = root / OUT_REL
    return (
        out_dir / f"{scope}.json",
        out_dir / "debug" / scope,
        scope,
    )


def run_eval(
    *,
    root: Path,
    args: argparse.Namespace,
    answers: Path,
    report: Path,
    debug_dir: Path,
) -> int:
    cmd = [
        "uv",
        "run",
        "--project",
        str(root / "apps/ocr-worker"),
        "python",
        str(root / EVAL_REL),
        "--samples-dir",
        str(root / SAMPLES_REL),
        "--answers",
        str(answers),
        "--report",
        str(report),
        "--mode",
        args.mode,
    ]
    if args.match_no is not None:
        cmd.extend(["--match", str(args.match_no)])
    if args.mode == "debug":
        cmd.extend(["--debug-dir", str(args.debug_dir or debug_dir)])
    if args.mode == "timing":
        cmd.extend(["--repeat", str(args.repeat)])
    if args.summary_only:
        cmd.append("--summary-only")

    env = os.environ.copy()
    completed = subprocess.run(
        cmd, cwd=root, env=env, text=True, capture_output=True, check=False
    )
    if completed.stderr:
        sys.stderr.write(completed.stderr)
    if completed.stdout:
        sys.stdout.write(completed.stdout)
    return completed.returncode


def pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.2f}%"


def load_report(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def top_diff_fields(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[tuple[str, str]] = Counter()
    for result in results:
        screen = str(result.get("screen_type"))
        for diff in result.get("diffs", []):
            counts[(screen, str(diff.get("field")))] += 1
    return [
        {"screen_type": screen, "field": field, "count": count}
        for (screen, field), count in counts.most_common(12)
    ]


def warning_counts(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for result in results:
        for warning in result.get("warnings", []):
            counts[str(warning).split(":", 1)[0]] += 1
    return [
        {"warning": warning, "count": count} for warning, count in counts.most_common()
    ]


def worst_images(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for result in results:
        total = int(result.get("field_total") or 0)
        correct = int(result.get("field_correct") or 0)
        diffs = result.get("diffs", [])
        items.append(
            {
                "file": result.get("file"),
                "match_no": result.get("match_no"),
                "screen_type": result.get("screen_type"),
                "accuracy": (correct / total) if total else None,
                "diffs": len(diffs),
                "failure": result.get("failure"),
                "warnings": len(result.get("warnings", [])),
            }
        )
    items.sort(
        key=lambda item: (
            item["failure"] is not None,
            item["diffs"],
            item["warnings"],
            str(item["file"]),
        ),
        reverse=True,
    )
    return items[:10]


def per_match_summary(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, int]] = defaultdict(
        lambda: {"total": 0, "correct": 0, "images": 0}
    )
    for result in results:
        match_no = int(result.get("match_no"))
        buckets[match_no]["total"] += int(result.get("field_total") or 0)
        buckets[match_no]["correct"] += int(result.get("field_correct") or 0)
        buckets[match_no]["images"] += 1
    rows = []
    for match_no, stats in sorted(buckets.items()):
        total = stats["total"]
        rows.append(
            {
                "match_no": match_no,
                **stats,
                "accuracy": (stats["correct"] / total) if total else None,
            }
        )
    return rows


def incident_log_candidate_quality(results: list[dict[str, Any]]) -> dict[str, Any]:
    quality: dict[str, Any] = {
        "threshold": INCIDENT_LOG_LOW_CONFIDENCE_THRESHOLD,
        "images": 0,
        "cells": 0,
        "low_confidence_cells": 0,
        "missing_confidence_cells": 0,
        "multi_candidate_cells": 0,
        "suspicious_cells": 0,
        "missing_debug_files": [],
        "examples": [],
    }
    examples: list[dict[str, Any]] = []

    for result in results:
        if result.get("screen_type") != "incident_log":
            continue

        quality["images"] += 1
        file_name = str(result.get("file") or "")
        debug_dir = result.get("debug_dir")
        cells_path = (
            Path(str(debug_dir)) / "incident_log" / "cells.json" if debug_dir else None
        )
        if cells_path is None or not cells_path.is_file():
            quality["missing_debug_files"].append(file_name)
            continue

        with cells_path.open("r", encoding="utf-8") as fh:
            cells_payload = json.load(fh)
        cells = _cell_debug_values(cells_payload.get("cells"))
        if cells is None:
            quality["missing_debug_files"].append(file_name)
            continue

        for cell in cells:
            if not isinstance(cell, dict):
                continue

            quality["cells"] += 1
            confidence = _float_or_none(cell.get("final_confidence"))
            raw_text = str(cell.get("final_raw_text") or "")
            raw_candidate_count = _raw_candidate_count(raw_text)
            low_confidence = (
                confidence is not None
                and confidence < INCIDENT_LOG_LOW_CONFIDENCE_THRESHOLD
            )
            missing_confidence = confidence is None
            multi_candidate = raw_candidate_count > 1
            suspicious = low_confidence or missing_confidence or multi_candidate

            if low_confidence:
                quality["low_confidence_cells"] += 1
            if missing_confidence:
                quality["missing_confidence_cells"] += 1
            if multi_candidate:
                quality["multi_candidate_cells"] += 1
            if suspicious:
                quality["suspicious_cells"] += 1
                examples.append(
                    {
                        "file": file_name,
                        "incident": cell.get("incident_name"),
                        "player": int(cell.get("player_index") or 0) + 1,
                        "count": cell.get("final_count"),
                        "confidence": confidence,
                        "raw_candidate_count": raw_candidate_count,
                        "raw": raw_text,
                        "low_confidence": low_confidence,
                        "missing_confidence": missing_confidence,
                        "multi_candidate": multi_candidate,
                        "cell_image": str(
                            cells_path.parent / str(cell.get("cell_image"))
                        ),
                    }
                )

    examples.sort(key=_incident_quality_example_sort_key)
    quality["examples"] = examples[:MAX_INCIDENT_LOG_QUALITY_EXAMPLES]
    return quality


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _cell_debug_values(cells: Any) -> list[Any] | None:
    if isinstance(cells, dict):
        return list(cells.values())
    if isinstance(cells, list):
        return cells
    return None


def _raw_candidate_count(raw_text: str) -> int:
    if not raw_text:
        return 0
    return len([part for part in raw_text.split("|") if part.strip()])


def _incident_quality_example_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    confidence = item.get("confidence")
    sortable_confidence = confidence if isinstance(confidence, (int, float)) else -1.0
    return (
        not item.get("low_confidence"),
        not item.get("missing_confidence"),
        not item.get("multi_candidate"),
        sortable_confidence,
        -int(item.get("raw_candidate_count") or 0),
        str(item.get("file")),
        str(item.get("incident")),
        int(item.get("player") or 0),
    )


def build_digest(
    report: dict[str, Any], *, scope: str, answers_info: dict[str, Any]
) -> dict[str, Any]:
    results = list(report.get("results", []))
    return {
        "scope": scope,
        "mode": report.get("mode"),
        "repeat": report.get("repeat"),
        "samples_dir": report.get("samples_dir"),
        "answers": answers_info,
        "summary": report.get("summary", {}),
        "top_diff_fields": top_diff_fields(results),
        "warning_counts": warning_counts(results),
        "worst_images": worst_images(results),
        "per_match": per_match_summary(results),
        "incident_log_candidate_quality": incident_log_candidate_quality(results),
    }


def write_digest_files(report_path: Path, digest: dict[str, Any]) -> tuple[Path, Path]:
    json_path = report_path.with_suffix(".digest.json")
    md_path = report_path.with_suffix(".digest.md")
    json_path.write_text(
        json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    summary = digest["summary"]
    duration = summary.get("duration_ms", {})
    lines = [
        "# OCR Accuracy Digest",
        "",
        f"- Scope: `{digest['scope']}`",
        f"- Mode: `{digest['mode']}`",
        f"- Samples: `{digest['samples_dir']}`",
        f"- Answers: `{digest['answers']['answers_path']}`",
        f"- Answer rows appended: `{digest['answers'].get('appended_rows', 0)}`",
        "",
        "## Quantitative Summary",
        "",
        f"- Images: {summary.get('images')}",
        f"- Fields: {summary.get('fields_correct')}/{summary.get('fields_total')} ({pct(summary.get('accuracy'))})",
        f"- Failures: {len(summary.get('failures', []))}",
        f"- Duration mean: {duration.get('mean')} ms",
        f"- Duration p95: {duration.get('p95')} ms",
        "",
        "## Player Order",
        "",
    ]
    player_order = summary.get("player_order", {})
    lines.extend(
        [
            f"- Direct: {player_order.get('direct_matches')}/"
            f"{player_order.get('direct_total')} ({pct(player_order.get('direct_accuracy'))})",
            f"- Fallback name matches: {player_order.get('fallback_name_matches')}",
            f"- Unresolved players: {player_order.get('unresolved_players')}",
            "",
        ]
    )
    lines.extend(
        [
            "## By Screen Type",
            "",
        ]
    )
    for screen, stats in summary.get("by_screen_type", {}).items():
        lines.append(
            f"- {screen}: {stats.get('correct')}/{stats.get('total')} "
            f"({pct(stats.get('accuracy'))}), images={stats.get('images')}"
        )

    quality = digest.get("incident_log_candidate_quality", {})
    lines.extend(["", "## Incident Log Candidate Quality", ""])
    if quality.get("images"):
        threshold = quality.get("threshold")
        lines.extend(
            [
                f"- Images: {quality.get('images')}",
                f"- Cells: {quality.get('cells')}",
                f"- Low confidence (<{threshold:.2f}): "
                f"{quality.get('low_confidence_cells')}",
                f"- Missing confidence: {quality.get('missing_confidence_cells')}",
                f"- Multiple raw candidates: {quality.get('multi_candidate_cells')}",
                f"- Suspicious cells: {quality.get('suspicious_cells')}",
            ]
        )
        missing_debug_files = quality.get("missing_debug_files", [])
        if missing_debug_files:
            lines.append(
                "- Missing debug files: "
                + ", ".join(str(item) for item in missing_debug_files)
            )
        examples = quality.get("examples", [])
        if examples:
            lines.extend(["", "### Candidate Examples", ""])
            for item in examples:
                flags = []
                if item.get("low_confidence"):
                    flags.append("low_confidence")
                if item.get("missing_confidence"):
                    flags.append("missing_confidence")
                if item.get("multi_candidate"):
                    flags.append("multi_candidate")
                lines.append(
                    f"- {item.get('file')} / {item.get('incident')} player {item.get('player')}: "
                    f"count={item.get('count')}, confidence={item.get('confidence')}, "
                    f"raw_candidates={item.get('raw_candidate_count')}, flags={','.join(flags)}, "
                    f"raw=`{item.get('raw')}`, cell=`{item.get('cell_image')}`"
                )
    else:
        lines.append("- no incident_log images")

    lines.extend(["", "## Top Diff Fields", ""])
    for item in digest["top_diff_fields"][:10]:
        lines.append(f"- {item['screen_type']} / {item['field']}: {item['count']}")

    lines.extend(["", "## Worst Images", ""])
    for item in digest["worst_images"][:10]:
        lines.append(
            f"- {item['file']}: accuracy={pct(item['accuracy'])}, diffs={item['diffs']}, "
            f"failure={item['failure']}, warnings={item['warnings']}"
        )

    lines.extend(["", "## Warning Counts", ""])
    if digest["warning_counts"]:
        for item in digest["warning_counts"]:
            lines.append(f"- {item['warning']}: {item['count']}")
    else:
        lines.append("- none")

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def main() -> int:
    args = parse_args()
    root = find_repo_root()
    samples_dir = root / SAMPLES_REL
    samples = select_samples(samples_dir, args.match_no)
    needed_matches = required_match_numbers(samples)
    answers = answer_path(samples_dir)
    answers_info = ensure_answers(
        answers=answers,
        needed_matches=needed_matches,
        no_fetch=args.no_fetch,
    )
    report, debug_dir, scope = default_paths(root, args.match_no)
    if args.report is not None:
        report = args.report if args.report.is_absolute() else root / args.report

    prepared = {
        "scope": scope,
        "target_images": len(samples),
        "target_matches": sorted(needed_matches),
        "answers": answers_info,
        "report": str(report),
        "debug_dir": str(args.debug_dir or debug_dir),
    }
    if args.prepare_only:
        print(json.dumps(prepared, ensure_ascii=False, indent=2))
        return 0

    report.parent.mkdir(parents=True, exist_ok=True)
    exit_code = run_eval(
        root=root,
        args=args,
        answers=answers,
        report=report,
        debug_dir=debug_dir,
    )
    if exit_code not in (0, 1):
        return exit_code
    if not report.is_file():
        raise SystemExit(f"expected report was not written: {report}")

    full_report = load_report(report)
    digest = build_digest(full_report, scope=scope, answers_info=answers_info)
    digest_json, digest_md = write_digest_files(report, digest)
    print(
        json.dumps(
            {
                **prepared,
                "eval_exit_code": exit_code,
                "digest_json": str(digest_json),
                "digest_md": str(digest_md),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
