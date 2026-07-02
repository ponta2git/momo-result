"""In-process Tesseract engine via tesserocr.

This engine keeps a long-lived ``PyTessBaseAPI`` per ``(language, oem)`` and
re-uses it across calls.

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
import threading
from collections.abc import Mapping
from types import MappingProxyType

from PIL import Image

from momo_ocr.features.text_recognition.engine import TextRecognitionEngine
from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
    RecognitionField,
    RecognizedText,
)
from momo_ocr.features.text_recognition.tesserocr_api import (
    ApiCacheEntry,
    ApiFactory,
    TesserocrApi,
    default_api_factory,
    resolve_tessdata_path,
)
from momo_ocr.features.text_recognition.tesserocr_config import (
    DEFAULT_FIELD_CONFIGS,
    DEFAULT_OEM,
    DEFAULT_TESSEROCR_CONFIG,
    apply_postprocessors,
    apply_psm,
    merge_config,
    raise_timeout_error,
    timeout_milliseconds,
)
from momo_ocr.shared.errors import FailureCode, OcrError

logger = logging.getLogger(__name__)

__all__ = ("DEFAULT_TESSEROCR_CONFIG", "TesserocrEngine")


class TesserocrEngine(TextRecognitionEngine):
    """In-process Tesseract recognizer with per-(language, oem) API caching."""

    def __init__(
        self,
        *,
        default_config: RecognitionConfig = DEFAULT_TESSEROCR_CONFIG,
        field_configs: Mapping[RecognitionField, RecognitionConfig] = DEFAULT_FIELD_CONFIGS,
        tessdata_path: str | None = None,
        api_factory: ApiFactory | None = None,
    ) -> None:
        self.default_config = default_config
        self.field_configs = MappingProxyType(dict(field_configs))
        if tessdata_path is not None:
            self._tessdata_path: str | None = tessdata_path
        else:
            self._tessdata_path = resolve_tessdata_path()
        self._api_factory = api_factory or default_api_factory()
        self._cache: dict[tuple[str, int], ApiCacheEntry] = {}
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
        oem = effective_config.oem if effective_config.oem is not None else DEFAULT_OEM
        if language is None:
            msg = "RecognitionConfig.language is required for tesserocr."
            raise OcrError(FailureCode.PARSER_FAILED, msg)

        entry = self._get_or_create_api(language=language, oem=oem)
        raw_text, confidence = self._recognize_with_entry(
            entry=entry,
            image=image,
            config=effective_config,
        )
        processed_text = apply_postprocessors(raw_text, effective_config)
        return RecognizedText(text=processed_text, confidence=confidence, raw_text=raw_text)

    def close(self) -> None:
        """Release every cached API. Safe to call multiple times."""
        with self._cache_lock:
            for entry in self._cache.values():
                _end_cache_entry(entry)
            self._cache.clear()

    def _resolve_config(
        self,
        *,
        field: RecognitionField,
        psm: int | None,
        config: RecognitionConfig | None,
    ) -> RecognitionConfig:
        field_config = self.field_configs.get(field, RecognitionConfig())
        effective_config = merge_config(self.default_config, field_config)
        if config is not None:
            effective_config = merge_config(effective_config, config)
        return apply_psm(effective_config, psm)

    def _get_or_create_api(self, *, language: str, oem: int) -> ApiCacheEntry:
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
                msg = "Failed to initialize tesserocr API."
                raise OcrError(
                    FailureCode.OCR_ENGINE_UNAVAILABLE,
                    msg,
                    retryable=False,
                    user_action="Verify tesserocr installation and TESSDATA_PREFIX.",
                ) from exc
            entry = ApiCacheEntry(api=api, lock=threading.Lock(), set_variable_keys=set())
            self._cache[key] = entry
            return entry

    def _recognize_with_entry(
        self,
        *,
        entry: ApiCacheEntry,
        image: Image.Image,
        config: RecognitionConfig,
    ) -> tuple[str, float | None]:
        api = entry.api
        with entry.lock:
            psm = config.psm if config.psm is not None else 3
            api.SetPageSegMode(psm)
            self._sync_variables(entry=entry, variables=config.variables)
            raw_text, confidence_raw = _run_recognition(api, image=image, config=config)
        if confidence_raw >= 0:
            confidence: float | None = confidence_raw / 100.0
        else:
            confidence = None
        return raw_text.strip(), confidence

    @staticmethod
    def _sync_variables(*, entry: ApiCacheEntry, variables: Mapping[str, str]) -> None:
        api = entry.api
        # Apply incoming overrides.
        for key, value in variables.items():
            api.SetVariable(key, value)
            entry.set_variable_keys.add(key)
        # Reset any previously-set key that is absent from this call.
        stale_keys = entry.set_variable_keys - set(variables.keys())
        for stale in stale_keys:
            api.SetVariable(stale, "")
        # Stale keys are kept in the tracker because resetting a variable to
        # "" still counts as a "we touched this" state we must rewind on the
        # next call if a different value is asked for.
        entry.set_variable_keys.update(variables.keys())


def _end_cache_entry(entry: ApiCacheEntry) -> None:
    api_end = getattr(entry.api, "End", None)
    if not callable(api_end):
        return
    try:
        api_end()
    except Exception:
        logger.exception("Failed to End() a cached PyTessBaseAPI; ignoring.")


def _run_recognition(
    api: TesserocrApi,
    *,
    image: Image.Image,
    config: RecognitionConfig,
) -> tuple[str, int | float]:
    try:
        api.SetImage(image)
        if not api.Recognize(timeout=timeout_milliseconds(config)):
            raise_timeout_error(config)
        return api.GetUTF8Text(), api.MeanTextConf()
    except OcrError:
        raise
    except Exception as exc:
        msg = "tesserocr recognition failed."
        raise OcrError(FailureCode.PARSER_FAILED, msg, retryable=False) from exc
    finally:
        _clear_api_state(api)


def _clear_api_state(api: TesserocrApi) -> None:
    for method_name in ("ClearAdaptiveClassifier", "Clear"):
        method = getattr(api, method_name, None)
        if callable(method):
            method()
