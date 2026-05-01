"""In-process Tesseract engine via tesserocr.

This engine eliminates the per-recognize subprocess overhead of
:class:`~momo_ocr.features.text_recognition.tesseract.TesseractEngine` by
keeping a long-lived ``PyTessBaseAPI`` per ``(language, oem)`` and re-using
it across calls.

State leak prevention
---------------------
``PyTessBaseAPI`` is stateful: ``SetPageSegMode`` and ``SetVariable`` calls
persist across ``GetUTF8Text`` invocations. We must therefore *explicitly
reset* every config knob on every call, otherwise a MONEY whitelist could
silently corrupt the next GENERIC field. Specifically, we:

* call ``SetPageSegMode(psm)`` on every recognize (even if it equals the
  previous value);
* track the set of variable keys we have ever set on this API and clear any
  key not present in the current call by setting it to ``""`` (the tesseract
  default for whitelist/blacklist style variables we use); and
* call ``Clear()`` at the end of each recognize for CLI parity (the
  ``tesseract`` binary spawns a fresh process each invocation).

Thread safety
-------------
``PyTessBaseAPI`` is not thread-safe, so each cached API is guarded by a
dedicated ``threading.Lock``. Concurrent recognize calls against the same
``(language, oem)`` are serialized, but calls against different keys can
proceed in parallel (each lock is independent).
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
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
from momo_ocr.features.text_recognition.tesseract import DEFAULT_FIELD_CONFIGS
from momo_ocr.shared.errors import FailureCode, OcrError

logger = logging.getLogger(__name__)

DEFAULT_TESSEROCR_CONFIG = RecognitionConfig(
    language="jpn+eng",
    oem=1,
    timeout_seconds=30.0,
    postprocessors=(normalize_ocr_text,),
)

_DEFAULT_OEM = 1

_TESSDATA_CANDIDATES: tuple[str, ...] = (
    "/opt/homebrew/share/tessdata",
    "/usr/local/share/tessdata",
    "/usr/share/tesseract-ocr/5/tessdata",
    "/usr/share/tesseract-ocr/4.00/tessdata",
    "/usr/share/tessdata",
)


def _resolve_tessdata_path() -> str | None:
    """Return a tessdata directory path or None to let tesseract auto-detect.

    Honors ``TESSDATA_PREFIX`` first, falls back to common install paths.
    Returning ``None`` lets ``PyTessBaseAPI`` apply its own defaults, which
    works on Linux distros where tessdata is at a standard location.
    """
    explicit = os.environ.get("TESSDATA_PREFIX")
    if explicit:
        return explicit
    for candidate in _TESSDATA_CANDIDATES:
        if Path(candidate).is_dir():
            return candidate
    return None


@dataclass(slots=True)
class _ApiCacheEntry:
    """One cached PyTessBaseAPI guarded by its own lock and var tracker."""

    api: object
    lock: threading.Lock
    set_variable_keys: set[str]


class TesserocrEngine(TextRecognitionEngine):
    """In-process Tesseract recognizer with per-(language, oem) API caching."""

    def __init__(
        self,
        *,
        default_config: RecognitionConfig = DEFAULT_TESSEROCR_CONFIG,
        field_configs: Mapping[RecognitionField, RecognitionConfig] = DEFAULT_FIELD_CONFIGS,
        tessdata_path: str | None = None,
        api_factory: object | None = None,
    ) -> None:
        self.default_config = default_config
        self.field_configs = MappingProxyType(dict(field_configs))
        if tessdata_path is not None:
            self._tessdata_path: str | None = tessdata_path
        else:
            self._tessdata_path = _resolve_tessdata_path()
        self._api_factory = api_factory or _default_api_factory()
        self._cache: dict[tuple[str, int], _ApiCacheEntry] = {}
        self._cache_lock = threading.Lock()

    def recognize(
        self,
        image: Image.Image,
        *,
        field: RecognitionField = RecognitionField.GENERIC,
        psm: int | None = None,
        config: RecognitionConfig | None = None,
    ) -> RecognizedText:
        effective_config = self._resolve_config(field=field, psm=psm, config=config)
        language = effective_config.language
        oem = effective_config.oem if effective_config.oem is not None else _DEFAULT_OEM
        if language is None:
            msg = "RecognitionConfig.language is required for tesserocr."
            raise OcrError(FailureCode.PARSER_FAILED, msg)

        entry = self._get_or_create_api(language=language, oem=oem)
        raw_text, confidence = self._recognize_with_entry(
            entry=entry,
            image=image,
            config=effective_config,
        )
        processed_text = _apply_postprocessors(raw_text, effective_config)
        return RecognizedText(text=processed_text, confidence=confidence, raw_text=raw_text)

    def close(self) -> None:
        """Release every cached API. Safe to call multiple times."""
        with self._cache_lock:
            for entry in self._cache.values():
                api_end = getattr(entry.api, "End", None)
                if callable(api_end):
                    try:
                        api_end()
                    except Exception:
                        logger.exception("Failed to End() a cached PyTessBaseAPI; ignoring.")
            self._cache.clear()

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

    def _get_or_create_api(self, *, language: str, oem: int) -> _ApiCacheEntry:
        key = (language, oem)
        with self._cache_lock:
            entry = self._cache.get(key)
            if entry is not None:
                return entry
            try:
                api = self._api_factory(
                    language=language,
                    oem=oem,
                    tessdata_path=self._tessdata_path,
                )
            except OcrError:
                raise
            except Exception as exc:
                msg = f"Failed to initialize tesserocr API for ({language}, oem={oem}): {exc}"
                raise OcrError(
                    FailureCode.OCR_ENGINE_UNAVAILABLE,
                    msg,
                    retryable=False,
                    user_action="Verify tesserocr installation and TESSDATA_PREFIX.",
                ) from exc
            entry = _ApiCacheEntry(api=api, lock=threading.Lock(), set_variable_keys=set())
            self._cache[key] = entry
            return entry

    def _recognize_with_entry(
        self,
        *,
        entry: _ApiCacheEntry,
        image: Image.Image,
        config: RecognitionConfig,
    ) -> tuple[str, float | None]:
        api = entry.api
        with entry.lock:
            psm = config.psm if config.psm is not None else 3
            api.SetPageSegMode(psm)  # type: ignore[attr-defined]
            self._sync_variables(entry=entry, variables=config.variables)
            try:
                api.SetImage(image)  # type: ignore[attr-defined]
                raw_text = api.GetUTF8Text()  # type: ignore[attr-defined]
                confidence_raw: int | float = api.MeanTextConf()  # type: ignore[attr-defined]
            except Exception as exc:
                msg = f"tesserocr recognize failed: {exc}"
                raise OcrError(FailureCode.PARSER_FAILED, msg, retryable=False) from exc
            finally:
                clear_adaptive = getattr(api, "ClearAdaptiveClassifier", None)
                if callable(clear_adaptive):
                    clear_adaptive()
                clear = getattr(api, "Clear", None)
                if callable(clear):
                    clear()
        if confidence_raw is not None and confidence_raw >= 0:
            confidence: float | None = confidence_raw / 100.0
        else:
            confidence = None
        return raw_text.strip(), confidence

    @staticmethod
    def _sync_variables(*, entry: _ApiCacheEntry, variables: Mapping[str, str]) -> None:
        api = entry.api
        # Apply incoming overrides.
        for key, value in variables.items():
            api.SetVariable(key, value)  # type: ignore[attr-defined]
            entry.set_variable_keys.add(key)
        # Reset any previously-set key that is absent from this call.
        stale_keys = entry.set_variable_keys - set(variables.keys())
        for stale in stale_keys:
            api.SetVariable(stale, "")  # type: ignore[attr-defined]
        # Stale keys are kept in the tracker because resetting a variable to
        # "" still counts as a "we touched this" state we must rewind on the
        # next call if a different value is asked for.
        entry.set_variable_keys.update(variables.keys())


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


def _apply_postprocessors(text: str, config: RecognitionConfig) -> str:
    processed = text
    for postprocessor in config.postprocessors:
        processed = postprocessor(processed)
    return processed


def _default_api_factory() -> Callable[..., object]:
    """Return a factory that builds real ``PyTessBaseAPI`` instances.

    Imported lazily so the module stays importable when ``tesserocr`` is
    not installed (e.g. CI without the ``inproc`` extra).
    """
    try:
        import tesserocr  # noqa: PLC0415
    except ImportError as exc:
        msg = (
            "tesserocr is not installed. "
            "Install with `uv sync --extra inproc` to use TesserocrEngine."
        )
        raise OcrError(
            FailureCode.OCR_ENGINE_UNAVAILABLE,
            msg,
            retryable=False,
            user_action="Install the 'inproc' extra or set MOMO_OCR_ENGINE=subprocess.",
        ) from exc

    def factory(*, language: str, oem: int, tessdata_path: str | None) -> object:
        kwargs: dict[str, object] = {"lang": language, "oem": oem}
        if tessdata_path is not None:
            kwargs["path"] = tessdata_path
        return tesserocr.PyTessBaseAPI(**kwargs)

    return factory
