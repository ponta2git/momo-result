"""Argparse + orchestrator for the OCR accuracy evaluator."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from eval_lib.report import aggregate
from eval_lib.runner import (
    ImageEval,
    evaluate_one,
    load_answers,
    resolve_debug_dir,
    select_files,
)
from momo_ocr.app.composition import default_text_recognition_engine


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate OCR accuracy against answers.tsv")
    parser.add_argument("--samples-dir", required=True, type=Path)
    parser.add_argument("--answers", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--mode", choices=("debug", "timing"), default="debug")
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Times to re-run analyze per image (timing mode); inner-loop only.",
    )
    parser.add_argument(
        "--debug-dir",
        type=Path,
        help="Override MOMO_OCR_DEBUG_DIR; only used in --mode debug.",
    )
    parser.add_argument(
        "--match",
        action="append",
        type=int,
        default=None,
        help="Restrict to one or more 対戦No. (repeatable).",
    )
    parser.add_argument(
        "--screen-types",
        action="append",
        choices=("01", "02", "03"),
        default=None,
        help="Restrict to one or more screen-type prefixes (01/02/03; repeatable).",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only the aggregate summary (per-image diffs still go to --report).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    samples_dir: Path = args.samples_dir
    if not samples_dir.is_dir():
        sys.stderr.write(f"samples-dir does not exist: {samples_dir}\n")
        return 2

    answers = load_answers(args.answers)
    matches = set(args.match) if args.match else None
    screen_prefixes = set(args.screen_types) if args.screen_types else None
    files = select_files(samples_dir, matches, screen_prefixes, args.limit)
    if not files:
        sys.stderr.write("no samples matched the filters\n")
        return 2

    records: list[ImageEval] = []
    text_engine = default_text_recognition_engine()
    for meta in files:
        debug_dir = resolve_debug_dir(meta, args.mode, args.debug_dir)
        record = evaluate_one(
            meta=meta,
            expected_players=answers.get(meta.match_no),
            debug_dir=debug_dir,
            repeat=args.repeat if args.mode == "timing" else 1,
            text_engine=text_engine,
        )
        records.append(record)
        if not args.summary_only:
            acc = f"{record.field_correct}/{record.field_total}" if record.field_total else "n/a"
            sys.stderr.write(
                f"[{meta.match_no:03d}/{meta.slot_prefix}] {meta.path.name} "
                f"{acc} fields  {record.duration_ms_mean:.0f}ms"
                f"{'  FAIL=' + record.failure if record.failure else ''}\n"
            )

    summary = aggregate(records)

    payload: dict[str, Any] = {
        "mode": args.mode,
        "repeat": args.repeat,
        "samples_dir": str(samples_dir),
        "summary": summary,
        "results": [r.__dict__ for r in records],
    }

    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0 if not summary["failures"] else 1
