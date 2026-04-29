from __future__ import annotations

from pathlib import Path

from PIL import Image

from momo_ocr.features.standalone_analysis.analyze_image import analyze_image


def test_analyze_image_returns_metadata_and_pending_parser_result(tmp_path: Path) -> None:
    image_path = tmp_path / "assets.jpg"
    Image.new("RGB", (1920, 1080), color="white").save(image_path, format="JPEG")

    result = analyze_image(
        image_path=image_path,
        requested_screen_type="total_assets",
        debug_dir=None,
        include_raw_text=False,
    )

    assert result.failure_code is None
    assert result.input is not None
    assert result.input.width == 1920
    assert result.detection is not None
    assert result.detection.profile_id == "full-hd-total-assets-v1"
    assert result.result is not None
    assert result.result.category_payload["status"] == "pending_parser"
