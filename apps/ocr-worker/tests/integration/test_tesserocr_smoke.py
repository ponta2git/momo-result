"""Smoke test for the in-process tesserocr engine.

Runs a real OCR call against a generated image to ensure the default
production OCR engine initializes and produces text.
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
)
from momo_ocr.features.text_recognition.tesserocr_engine import (
    TesserocrEngine,
)


def _render_text_image(text: str, *, size: tuple[int, int] = (240, 80)) -> Image.Image:
    image = Image.new("RGB", size, color="white")
    draw = ImageDraw.Draw(image)
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc",
            size=36,
        )
    except OSError:  # pragma: no cover - fallback
        font = ImageFont.load_default()
    draw.text((10, 18), text, fill="black", font=font)
    return image


def test_tesserocr_engine_recognizes_simple_digits() -> None:
    image = _render_text_image("12345")
    engine = TesserocrEngine()
    try:
        result = engine.recognize(
            image,
            field=RecognitionField.MONEY,
            psm=7,
            config=RecognitionConfig(
                language="eng",
                psm=7,
                variables={"tessedit_char_whitelist": "0123456789"},
            ),
        )
    finally:
        engine.close()

    assert "12345" in result.text.replace(" ", "")
    assert result.confidence is not None
    assert result.confidence > 0.5


def test_tesserocr_engine_state_does_not_leak_in_real_api() -> None:
    """Whitelist set during MONEY must not corrupt a follow-up GENERIC call."""
    digits_image = _render_text_image("789")
    engine = TesserocrEngine()
    try:
        money_result = engine.recognize(
            digits_image,
            field=RecognitionField.MONEY,
            psm=7,
            config=RecognitionConfig(
                language="eng",
                psm=7,
                variables={"tessedit_char_whitelist": "0123456789"},
            ),
        )
        assert "789" in money_result.text.replace(" ", "")

        # Now recognize a non-digit string with no whitelist; if state leaks,
        # tesseract will refuse to emit any letters.
        text_image = _render_text_image("ABC")
        generic_result = engine.recognize(
            text_image,
            field=RecognitionField.GENERIC,
            psm=7,
            config=RecognitionConfig(language="eng", psm=7),
        )
    finally:
        engine.close()

    assert any(letter in generic_result.text for letter in ("A", "B", "C"))
