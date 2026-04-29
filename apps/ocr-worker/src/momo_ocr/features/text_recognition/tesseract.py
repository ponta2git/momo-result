from __future__ import annotations

import shutil
import subprocess
import tempfile

from PIL import Image

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import RecognizedText
from momo_ocr.shared.errors import FailureCode, OcrError


class TesseractEngine(TextRecognitionEngine):
    def __init__(self, *, language: str = "jpn+eng", timeout_seconds: int = 30) -> None:
        self.language = language
        self.timeout_seconds = timeout_seconds

    def recognize(self, image: Image.Image, *, psm: int | None = None) -> RecognizedText:
        if shutil.which("tesseract") is None:
            raise OcrError(
                FailureCode.OCR_ENGINE_UNAVAILABLE, "tesseract command is not installed."
            )

        with tempfile.NamedTemporaryFile(suffix=".png") as image_file:
            image.save(image_file.name)
            command = ["tesseract", image_file.name, "stdout", "-l", self.language]
            if psm is not None:
                command.extend(["--psm", str(psm)])
            try:
                completed = subprocess.run(  # noqa: S603
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                raise OcrError(FailureCode.OCR_TIMEOUT, "tesseract timed out.") from exc
            except subprocess.CalledProcessError as exc:
                raise OcrError(
                    FailureCode.PARSER_FAILED, exc.stderr.strip() or "tesseract failed."
                ) from exc

        return RecognizedText(text=completed.stdout.strip(), confidence=None)
