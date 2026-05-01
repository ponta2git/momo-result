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
        # Cache the resolved executable path at construction so the hot
        # recognize() loop does not pay shutil.which() PATH-walk overhead.
        # We tolerate a missing binary at construction (no raise) so unit
        # tests that never call recognize() can still instantiate the
        # engine; the missing-binary error is raised lazily below.
        resolved = shutil.which(executable)
        self._executable_path: str | None = resolved

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        executable_path = self._executable_path
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

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "input.png"
            output_base = Path(tmpdir) / "out"
            image.save(image_path)
            command = _build_tesseract_command(
                executable_path=Path(executable_path),
                image_path=image_path,
                output_base=output_base,
                config=effective_config,
            )
            try:
                subprocess.run(  # noqa: S603
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

            txt_path = output_base.with_suffix(".txt")
            tsv_path = output_base.with_suffix(".tsv")
            raw_text = txt_path.read_text(encoding="utf-8").strip() if txt_path.exists() else ""
            tsv_stdout = tsv_path.read_text(encoding="utf-8") if tsv_path.exists() else ""

        _, confidence = _parse_tesseract_tsv(tsv_stdout)
        processed_text = _apply_postprocessors(raw_text, effective_config)
        return RecognizedText(text=processed_text, confidence=confidence, raw_text=raw_text)

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
    output_base: Path,
    config: RecognitionConfig,
) -> list[str]:
    command = [str(executable_path), str(image_path), str(output_base)]
    if config.language is not None:
        command.extend(["-l", config.language])
    if config.oem is not None:
        command.extend(["--oem", str(config.oem)])
    if config.psm is not None:
        command.extend(["--psm", str(config.psm)])
    for key, value in sorted(config.variables.items()):
        command.extend(["-c", f"{key}={value}"])
    command.extend(["txt", "tsv"])
    return command


_TSV_WORD_LEVEL = "5"


def _parse_tesseract_tsv(stdout: str) -> tuple[str, float | None]:
    """Parse tesseract TSV stdout into text and aggregated word confidence.

    Tesseract's TSV output has one row per detection level. Word-level
    rows (level == 5) carry both the recognized text and a per-word
    confidence in 0-100 (with -1 used for non-word entries). We
    reconstruct the text by inserting newlines between distinct
    block/par/line tuples to keep PSM 6/11 multi-line layouts faithful,
    and compute the mean of positive confidences as the row score.
    """
    lines = stdout.splitlines()
    if not lines:
        return "", None
    indices = _resolve_tsv_indices(lines[0])
    if indices is None:
        return stdout.strip(), None

    parts: list[str] = []
    confidences: list[float] = []
    last_line_key: tuple[str, str, str] | None = None
    for raw in lines[1:]:
        word_row = _parse_word_row(raw, indices)
        if word_row is None:
            continue
        word, line_key, conf_value = word_row
        if last_line_key is not None and line_key != last_line_key:
            parts.append("\n")
        elif parts:
            parts.append(" ")
        parts.append(word)
        last_line_key = line_key
        if conf_value is not None and conf_value >= 0:
            confidences.append(conf_value)

    text = "".join(parts).strip()
    confidence = sum(confidences) / len(confidences) / 100.0 if confidences else None
    return text, confidence


def _resolve_tsv_indices(header_line: str) -> dict[str, int] | None:
    header = header_line.split("\t")
    keys = ("level", "block_num", "par_num", "line_num", "conf", "text")
    try:
        return {key: header.index(key) for key in keys}
    except ValueError:
        return None


def _parse_word_row(
    raw: str, indices: dict[str, int]
) -> tuple[str, tuple[str, str, str], float | None] | None:
    cells = raw.split("\t") if raw else []
    if len(cells) <= indices["text"] or cells[indices["level"]] != _TSV_WORD_LEVEL:
        return None
    word = cells[indices["text"]]
    if not word:
        return None
    line_key = (cells[indices["block_num"]], cells[indices["par_num"]], cells[indices["line_num"]])
    try:
        conf_value: float | None = float(cells[indices["conf"]])
    except ValueError:
        conf_value = None
    return word, line_key, conf_value


def _apply_postprocessors(text: str, config: RecognitionConfig) -> str:
    processed = text
    for postprocessor in config.postprocessors:
        processed = postprocessor(processed)
    return processed
