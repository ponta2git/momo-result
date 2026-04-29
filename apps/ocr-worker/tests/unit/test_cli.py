from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from momo_ocr.app.cli import main


def test_cli_analyze_writes_json_and_returns_zero_with_fake_engine(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    output_path = tmp_path / "result.json"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")

    exit_code = main(
        [
            "analyze",
            "--image",
            str(image_path),
            "--type",
            "auto",
            "--ocr-engine",
            "fake",
            "--fake-text",
            "総資産",
            "--output",
            str(output_path),
        ]
    )

    output = json.loads(output_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert output["detection"]["detected_type"] == "total_assets"
    assert output["result"]["category_payload"]["parser"] == "total_assets"


def test_cli_analyze_returns_nonzero_when_auto_detection_cannot_parse(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "unknown.jpg"
    output_path = tmp_path / "result.json"
    Image.new("RGB", (1280, 720), color="white").save(image_path, format="JPEG")

    exit_code = main(
        [
            "analyze",
            "--image",
            str(image_path),
            "--type",
            "auto",
            "--ocr-engine",
            "fake",
            "--fake-text",
            "unknown",
            "--output",
            str(output_path),
        ]
    )

    output = json.loads(output_path.read_text(encoding="utf-8"))
    assert exit_code == 1
    assert output["detection"]["detected_type"] is None
    assert output["result"] is None
