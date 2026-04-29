from __future__ import annotations

import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from types import MappingProxyType

from PIL import Image

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text
from momo_ocr.shared.errors import FailureCode, OcrError

DEFAULT_TESSERACT_CONFIG = RecognitionConfig(
    language="jpn+eng",
    oem=1,
    timeout_seconds=30.0,
    postprocessors=(normalize_ocr_text,),
)

DEFAULT_FIELD_CONFIGS: Mapping[RecognitionField, RecognitionConfig] = MappingProxyType(
    {
        RecognitionField.GENERIC: RecognitionConfig(),
        RecognitionField.TITLE: RecognitionConfig(psm=6),
        RecognitionField.MONEY: RecognitionConfig(
            language="eng",
            psm=7,
            variables={"tessedit_char_whitelist": "0123456789,-. "},
        ),
        RecognitionField.PLAYER_NAME: RecognitionConfig(psm=7),
        RecognitionField.INCIDENT_LOG: RecognitionConfig(psm=6),
    }
)


class TesseractEngine(TextRecognitionEngine):
    def __init__(
        self,
        *,
        executable: str = "tesseract",
        default_config: RecognitionConfig = DEFAULT_TESSERACT_CONFIG,
        field_configs: Mapping[RecognitionField, RecognitionConfig] = DEFAULT_FIELD_CONFIGS,
    ) -> None:
        self.executable = executable
        self.default_config = default_config
        self.field_configs = field_configs

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        executable_path = shutil.which(self.executable)
        if executable_path is None:
            raise OcrError(
                FailureCode.OCR_ENGINE_UNAVAILABLE,
                f"{self.executable} command is not installed.",
                retryable=False,
                user_action="Install Tesseract locally or configure the worker image.",
            )

        effective_config = self._resolve_config(field=field, psm=psm, config=config)
        timeout_seconds = effective_config.timeout_seconds
        if timeout_seconds is None or timeout_seconds <= 0:
            raise OcrError(
                FailureCode.PARSER_FAILED,
                "Tesseract timeout must be a positive number of seconds.",
            )

        with tempfile.NamedTemporaryFile(suffix=".png") as image_file:
            image.save(image_file.name)
            command = _build_tesseract_command(
                executable_path=Path(executable_path),
                image_path=Path(image_file.name),
                config=effective_config,
            )
            try:
                completed = subprocess.run(  # noqa: S603
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                raise OcrError(
                    FailureCode.OCR_TIMEOUT,
                    f"Tesseract timed out after {timeout_seconds:g} seconds.",
                    retryable=True,
                    user_action="Try the upload again or use manual entry if OCR keeps timing out.",
                ) from exc
            except subprocess.CalledProcessError as exc:
                raise OcrError(
                    FailureCode.PARSER_FAILED,
                    exc.stderr.strip() or "Tesseract failed.",
                    retryable=False,
                ) from exc

        raw_text = completed.stdout.strip()
        processed_text = _apply_postprocessors(raw_text, effective_config)
        return RecognizedText(text=processed_text, confidence=None, raw_text=raw_text)

    def _resolve_config(
        self,
        *,
        field: RecognitionField,
        psm: int | None,
        config: RecognitionConfig | None,
    ) -> RecognitionConfig:
        field_config = self.field_configs.get(field, RecognitionConfig())
        effective_config = _merge_config(self.default_config, field_config)
        if config is not None:
            effective_config = _merge_config(effective_config, config)
        if psm is not None:
            effective_config = replace(effective_config, psm=psm)
        return effective_config


def _merge_config(base: RecognitionConfig, override: RecognitionConfig) -> RecognitionConfig:
    return RecognitionConfig(
        language=override.language if override.language is not None else base.language,
        psm=override.psm if override.psm is not None else base.psm,
        oem=override.oem if override.oem is not None else base.oem,
        timeout_seconds=(
            override.timeout_seconds
            if override.timeout_seconds is not None
            else base.timeout_seconds
        ),
        variables={**base.variables, **override.variables},
        postprocessors=(*base.postprocessors, *override.postprocessors),
    )


def _build_tesseract_command(
    *,
    executable_path: Path,
    image_path: Path,
    config: RecognitionConfig,
) -> list[str]:
    command = [str(executable_path), str(image_path), "stdout"]
    if config.language is not None:
        command.extend(["-l", config.language])
    if config.oem is not None:
        command.extend(["--oem", str(config.oem)])
    if config.psm is not None:
        command.extend(["--psm", str(config.psm)])
    for key, value in sorted(config.variables.items()):
        command.extend(["-c", f"{key}={value}"])
    return command


def _apply_postprocessors(text: str, config: RecognitionConfig) -> str:
    processed = text
    for postprocessor in config.postprocessors:
        processed = postprocessor(processed)
    return processed
