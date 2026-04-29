from __future__ import annotations

import argparse
import sys
from pathlib import Path

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image
from momo_ocr.features.standalone_analysis.batch_calibration import analyze_directory
from momo_ocr.shared.json import write_json


def main() -> None:
    parser = argparse.ArgumentParser(prog="momo-ocr")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze one local image without DB/Redis/API")
    analyze.add_argument("--image", required=True, type=Path)
    analyze.add_argument(
        "--type", default="auto", choices=["auto", "total_assets", "revenue", "incident_log"]
    )
    analyze.add_argument("--output", type=Path)
    analyze.add_argument("--debug-dir", type=Path)
    analyze.add_argument("--include-raw-text", action="store_true")

    batch = subparsers.add_parser("batch", help="Analyze a directory of local images")
    batch.add_argument("--input-dir", required=True, type=Path)
    batch.add_argument("--expected-dir", type=Path)
    batch.add_argument("--report", type=Path)
    batch.add_argument("--debug-dir", type=Path)

    args = parser.parse_args()

    if args.command == "analyze":
        result = analyze_image(
            image_path=args.image,
            requested_image_type=args.type,
            debug_dir=args.debug_dir,
            include_raw_text=args.include_raw_text,
        )
        if args.output is not None:
            write_json(args.output, result)
        else:
            sys.stdout.write(f"{result.to_json()}\n")
        return

    if args.command == "batch":
        report = analyze_directory(
            input_dir=args.input_dir,
            expected_dir=args.expected_dir,
            debug_dir=args.debug_dir,
        )
        if args.report is not None:
            write_json(args.report, report)
        else:
            sys.stdout.write(f"{report.to_json()}\n")
        return

    message = f"Unhandled command: {args.command}"
    raise AssertionError(message)
