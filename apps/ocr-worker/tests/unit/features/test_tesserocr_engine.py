"""State-leak and caching tests for :class:`TesserocrEngine`.

Uses a fake ``PyTessBaseAPI`` (the engine accepts an injected ``api_factory``)
so these tests run without ``tesserocr`` installed and without any tessdata.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import pytest
from PIL import Image

from momo_ocr.features.text_recognition.models import (
    RecognitionConfig,
)
from momo_ocr.features.text_recognition.tesserocr_engine import TesserocrEngine


@dataclass
class _FakeApi:
    """Records every call so tests can assert ordering and reset behavior."""

    language: str
    oem: int
    tessdata_path: str | None
    calls: list[tuple[str, tuple[Any, ...]]] = field(default_factory=list)
    text: str = "hello"
    confidence: int = 87

    def SetPageSegMode(self, psm: int) -> None:  # noqa: N802 - tesserocr API
        self.calls.append(("SetPageSegMode", (psm,)))

    def SetVariable(self, key: str, value: str) -> None:  # noqa: N802
        self.calls.append(("SetVariable", (key, value)))

    def SetImage(self, image: Image.Image) -> None:  # noqa: N802
        self.calls.append(("SetImage", (image.mode,)))

    def GetUTF8Text(self) -> str:  # noqa: N802
        self.calls.append(("GetUTF8Text", ()))
        return self.text + "\n"

    def MeanTextConf(self) -> int:  # noqa: N802
        self.calls.append(("MeanTextConf", ()))
        return self.confidence

    def Clear(self) -> None:  # noqa: N802
        self.calls.append(("Clear", ()))

    def End(self) -> None:  # noqa: N802
        self.calls.append(("End", ()))


def _make_engine() -> tuple[TesserocrEngine, list[_FakeApi]]:
    created: list[_FakeApi] = []

    def factory(*, language: str, oem: int, tessdata_path: str | None) -> _FakeApi:
        api = _FakeApi(language=language, oem=oem, tessdata_path=tessdata_path)
        created.append(api)
        return api

    engine = TesserocrEngine(
        field_configs={},
        tessdata_path=None,
        api_factory=factory,
    )
    return engine, created


def _img() -> Image.Image:
    return Image.new("RGB", (8, 8), color="white")


def _calls_of(api: _FakeApi, names: Iterable[str]) -> list[tuple[str, tuple[Any, ...]]]:
    wanted = set(names)
    return [c for c in api.calls if c[0] in wanted]


def test_psm_is_set_on_every_call_to_prevent_leak() -> None:
    engine, apis = _make_engine()

    engine.recognize(
        _img(),
        psm=10,
        config=RecognitionConfig(language="jpn+eng"),
    )
    engine.recognize(
        _img(),
        psm=13,
        config=RecognitionConfig(language="jpn+eng"),
    )

    assert len(apis) == 1, "same (language, oem) must reuse the cached API"
    psm_calls = _calls_of(apis[0], {"SetPageSegMode"})
    assert psm_calls == [("SetPageSegMode", (10,)), ("SetPageSegMode", (13,))]


def test_whitelist_variable_is_reset_when_next_call_omits_it() -> None:
    engine, apis = _make_engine()

    engine.recognize(
        _img(),
        config=RecognitionConfig(
            language="jpn+eng",
            psm=7,
            variables={"tessedit_char_whitelist": "0123456789"},
        ),
    )
    engine.recognize(
        _img(),
        config=RecognitionConfig(language="jpn+eng", psm=6),
    )

    var_calls = _calls_of(apis[0], {"SetVariable"})
    # First recognize sets the whitelist; second must reset it to "".
    assert ("SetVariable", ("tessedit_char_whitelist", "0123456789")) in var_calls
    assert ("SetVariable", ("tessedit_char_whitelist", "")) in var_calls
    # Reset must come after the original set.
    set_index = var_calls.index(("SetVariable", ("tessedit_char_whitelist", "0123456789")))
    reset_index = var_calls.index(("SetVariable", ("tessedit_char_whitelist", "")))
    assert reset_index > set_index


def test_different_languages_get_separate_api_instances() -> None:
    engine, apis = _make_engine()

    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))
    engine.recognize(_img(), config=RecognitionConfig(language="eng"))
    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))

    assert len(apis) == 2
    assert {a.language for a in apis} == {"jpn+eng", "eng"}


def test_clear_is_called_after_each_recognize_for_cli_parity() -> None:
    engine, apis = _make_engine()

    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))
    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))

    clear_calls = _calls_of(apis[0], {"Clear"})
    assert len(clear_calls) == 2


def test_image_is_passed_through_to_set_image_in_native_mode() -> None:
    """Phase C canary established that ``convert("L")`` regresses accuracy
    (subprocess writes the image as PNG and lets Tesseract handle binarization).
    The engine must therefore pass the image through in its native mode.
    """
    engine, apis = _make_engine()

    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))

    set_image_calls = _calls_of(apis[0], {"SetImage"})
    # _img() is RGB; we must NOT downcast to L.
    assert set_image_calls == [("SetImage", ("RGB",))]


def test_recognize_returns_text_and_normalized_confidence() -> None:
    engine, apis = _make_engine()
    apis_holder: list[_FakeApi] = apis  # capture before call so we can mutate

    # Tweak confidence on the API the engine will create. Confidence is set
    # at instantiation time inside the factory, so override default.
    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))
    apis_holder[0].text = "東京"
    apis_holder[0].confidence = 92
    result = engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))

    assert result.text == "東京"
    assert result.raw_text == "東京"
    assert result.confidence == pytest.approx(0.92)


def test_negative_confidence_becomes_none() -> None:
    engine, apis = _make_engine()

    # First call to instantiate the API.
    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))
    apis[0].confidence = -1
    result = engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))

    assert result.confidence is None


def test_variable_changes_overwrite_without_double_reset() -> None:
    """Switching a variable's value must not first reset and then re-set."""
    engine, apis = _make_engine()

    engine.recognize(
        _img(),
        config=RecognitionConfig(
            language="jpn+eng",
            variables={"tessedit_char_whitelist": "0123"},
        ),
    )
    engine.recognize(
        _img(),
        config=RecognitionConfig(
            language="jpn+eng",
            variables={"tessedit_char_whitelist": "abcd"},
        ),
    )

    set_var_calls = _calls_of(apis[0], {"SetVariable"})
    # Expect the override to be applied once per call without a redundant
    # empty-string reset between them.
    assert ("SetVariable", ("tessedit_char_whitelist", "0123")) in set_var_calls
    assert ("SetVariable", ("tessedit_char_whitelist", "abcd")) in set_var_calls
    # No "" reset should appear in this scenario.
    assert ("SetVariable", ("tessedit_char_whitelist", "")) not in set_var_calls


def test_close_calls_end_on_all_cached_apis() -> None:
    engine, apis = _make_engine()

    engine.recognize(_img(), config=RecognitionConfig(language="jpn+eng"))
    engine.recognize(_img(), config=RecognitionConfig(language="eng"))
    engine.close()

    for api in apis:
        assert ("End", ()) in api.calls
