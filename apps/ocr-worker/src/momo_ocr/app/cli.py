from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
from collections.abc import Sequence
from pathlib import Path

from momo_ocr.app.composition import production_worker_runtime
from momo_ocr.app.config import load_worker_config
from momo_ocr.app.logging import configure_logging
from momo_ocr.app.worker_process import WorkerLoopConfig, run_worker_process
from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.batch_calibration import (
    EVALUATION_SET_CHOICES,
    analyze_directory,
)
from momo_ocr.features.standalone_analysis.report import AnalysisResult, BatchReport
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine
from momo_ocr.shared.json import write_json

ENGINE_CHOICES = ("tesseract", "tesserocr", "fake")
SCREEN_TYPE_CHOICES = ("auto", "total_assets", "revenue", "incident_log")


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging(_log_level_from_env())
    parser = argparse.ArgumentParser(prog="momo-ocr")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze one local image without DB/Redis/API")
    analyze.add_argument("--image", required=True, type=Path)
    analyze.add_argument("--type", default="auto", choices=SCREEN_TYPE_CHOICES)
    analyze.add_argument("--output", type=Path)
    analyze.add_argument("--debug-dir", type=Path)
    analyze.add_argument("--include-raw-text", action="store_true")
    _add_engine_options(analyze)

    batch = subparsers.add_parser("batch", help="Analyze a directory of local images")
    batch.add_argument("--input-dir", required=True, type=Path)
    batch.add_argument("--expected-dir", type=Path)
    batch.add_argument("--report", type=Path)
    batch.add_argument("--debug-dir", type=Path)
    batch.add_argument("--include-raw-text", action="store_true")
    batch.add_argument(
        "--evaluation-set",
        default="all",
        choices=EVALUATION_SET_CHOICES,
        help=(
            "Which slice of input-dir to analyze: 'train' (top-level files only), "
            "'holdout' (input-dir/holdout/ only), or 'all' (default; both)."
        ),
    )
    _add_engine_options(batch)

    worker = subparsers.add_parser("worker", help="Run the Redis/Postgres OCR worker")
    worker.add_argument(
        "--idle-sleep-seconds",
        default=None,
        type=float,
        help="Override idle sleep interval for the worker loop.",
    )

    args = parser.parse_args(argv)

    if args.command == "analyze":
        text_engine = _build_text_engine(args)
        debug_dir = _resolve_analyze_debug_dir(args.debug_dir, args.image)
        result = analyze_image(
            image_path=args.image,
            requested_screen_type=args.type,
            debug_dir=debug_dir,
            include_raw_text=args.include_raw_text,
            text_engine=text_engine,
        )
        if args.output is not None:
            write_json(args.output, result)
        else:
            sys.stdout.write(f"{result.to_json()}\n")
        return _analysis_exit_code(result)

    if args.command == "batch":
        text_engine = _build_text_engine(args)
        debug_dir = _resolve_batch_debug_dir(args.debug_dir)
        report = analyze_directory(
            input_dir=args.input_dir,
            expected_dir=args.expected_dir,
            debug_dir=debug_dir,
            text_engine=text_engine,
            include_raw_text=args.include_raw_text,
            evaluation_set=args.evaluation_set,
        )
        if args.report is not None:
            write_json(args.report, report)
        else:
            sys.stdout.write(f"{report.to_json()}\n")
        return _batch_exit_code(report)

    if args.command == "worker":
        return _run_worker(args)

    message = f"Unhandled command: {args.command}"
    raise AssertionError(message)


def _add_engine_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--ocr-engine", default="tesseract", choices=ENGINE_CHOICES)
    parser.add_argument(
        "--fake-text",
        default="",
        help="OCR text returned by --ocr-engine fake; useful for deterministic local tests.",
    )


def _build_text_engine(args: argparse.Namespace) -> TextRecognitionEngine:
    if args.ocr_engine == "fake":
        return FakeTextRecognitionEngine(args.fake_text)
    if args.ocr_engine == "tesseract":
        return TesseractEngine()
    if args.ocr_engine == "tesserocr":
        return TesserocrEngine()
    message = f"Unhandled OCR engine: {args.ocr_engine}"
    raise AssertionError(message)


def _run_worker(args: argparse.Namespace) -> int:
    shutdown_event = threading.Event()

    def request_shutdown(_signum: int, _frame: object) -> None:
        shutdown_event.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    config = load_worker_config()
    runtime = production_worker_runtime(config)
    loop_config = (
        WorkerLoopConfig(idle_sleep_seconds=args.idle_sleep_seconds)
        if args.idle_sleep_seconds is not None
        else None
    )
    try:
        run_worker_process(runtime.deps, shutdown_event=shutdown_event, config=loop_config)
    finally:
        runtime.close()
    return 0


def _analysis_exit_code(result: AnalysisResult) -> int:
    if result.failure_code is not None or result.result is None:
        return 1
    return 0


def _batch_exit_code(report: BatchReport) -> int:
    if any(_analysis_exit_code(result) != 0 for result in report.results):
        return 1
    return 0


def _resolve_analyze_debug_dir(explicit: Path | None, image_path: Path) -> Path | None:
    """Return the effective debug dir for `analyze`.

    Priority: `--debug-dir` > `MOMO_OCR_DEBUG_DIR` env var. When the env var is
    used, the per-image subdir is `<base>/<image_stem>/` so the caller can map
    debug artifacts back to the input image. Returns ``None`` when neither is
    set, leaving the analyzer in production-equivalent (no-debug) mode.
    """

    if explicit is not None:
        return explicit
    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    return Path(base).expanduser() / image_path.stem


def _resolve_batch_debug_dir(explicit: Path | None) -> Path | None:
    """Return the effective debug dir base for `batch`.

    `analyze_directory` already creates per-image subdirs under the supplied
    base, so we only need to surface the env var when no explicit path was
    given.
    """

    if explicit is not None:
        return explicit
    base = os.environ.get("MOMO_OCR_DEBUG_DIR", "").strip()
    if not base:
        return None
    return Path(base).expanduser()


def _log_level_from_env() -> int:
    raw = os.environ.get("MOMO_LOG_LEVEL", "INFO").strip().upper()
    level = logging.getLevelName(raw)
    return level if isinstance(level, int) else logging.INFO
