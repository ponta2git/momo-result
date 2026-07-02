from __future__ import annotations

from dataclasses import replace
from typing import NoReturn

from momo_ocr.features.text_recognition.models import RecognitionConfig
from momo_ocr.features.text_recognition.postprocess import normalize_ocr_text
from momo_ocr.shared.errors import FailureCode, OcrError

DEFAULT_TESSEROCR_CONFIG = RecognitionConfig(
    language="jpn+eng",
    oem=1,
    timeout_seconds=30.0,
    postprocessors=(normalize_ocr_text,),
)

DEFAULT_OEM = 1


def merge_config(base: RecognitionConfig, override: RecognitionConfig) -> RecognitionConfig:
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


def apply_psm(config: RecognitionConfig, psm: int | None) -> RecognitionConfig:
    return replace(config, psm=psm) if psm is not None else config


def timeout_milliseconds(config: RecognitionConfig) -> int:
    timeout_seconds = config.timeout_seconds
    if timeout_seconds is None or timeout_seconds <= 0:
        raise OcrError(
            FailureCode.PARSER_FAILED,
            "tesserocr timeout must be a positive number of seconds.",
        )
    return max(1, round(timeout_seconds * 1000))


def raise_timeout_error(config: RecognitionConfig) -> NoReturn:
    timeout_seconds = config.timeout_seconds
    timeout_text = "configured" if timeout_seconds is None else f"{timeout_seconds:g} seconds"
    raise OcrError(
        FailureCode.OCR_TIMEOUT,
        f"tesserocr timed out after {timeout_text}.",
        retryable=True,
        user_action="Try the upload again or use manual entry if OCR keeps timing out.",
    )


def apply_postprocessors(text: str, config: RecognitionConfig) -> str:
    processed = text
    for postprocessor in config.postprocessors:
        processed = postprocessor(processed)
    return processed
