from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.batch_calibration import analyze_directory
from momo_ocr.features.standalone_analysis.report import AnalysisResult, BatchReport
from momo_ocr.features.text_recognition.engine import (
    FakeTextRecognitionEngine,
    TextRecognitionEngine,
)
from momo_ocr.features.text_recognition.tesseract import TesseractEngine
from momo_ocr.shared.json import write_json

ENGINE_CHOICES = ("tesseract", "fake")
SCREEN_TYPE_CHOICES = ("auto", "total_assets", "revenue", "incident_log")


def main(argv: Sequence[str] | None = None) -> int:
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
    _add_engine_options(batch)

    args = parser.parse_args(argv)

    if args.command == "analyze":
        text_engine = _build_text_engine(args)
        result = analyze_image(
            image_path=args.image,
            requested_screen_type=args.type,
            debug_dir=args.debug_dir,
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
        report = analyze_directory(
            input_dir=args.input_dir,
            expected_dir=args.expected_dir,
            debug_dir=args.debug_dir,
            text_engine=text_engine,
            include_raw_text=args.include_raw_text,
        )
        if args.report is not None:
            write_json(args.report, report)
        else:
            sys.stdout.write(f"{report.to_json()}\n")
        return _batch_exit_code(report)

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
    message = f"Unhandled OCR engine: {args.ocr_engine}"
    raise AssertionError(message)


def _analysis_exit_code(result: AnalysisResult) -> int:
    if result.failure_code is not None or result.result is None:
        return 1
    return 0


def _batch_exit_code(report: BatchReport) -> int:
    if any(_analysis_exit_code(result) != 0 for result in report.results):
        return 1
    return 0
