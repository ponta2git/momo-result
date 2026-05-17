from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any, cast

TESTS_ROOT = Path(__file__).resolve().parents[1]
OCR_WORKER_ROOT = TESTS_ROOT.parent
INTEGRATION_ROOT = TESTS_ROOT / "integration"


def test_default_pytest_gate_excludes_external_integration_tests() -> None:
    config = tomllib.loads((OCR_WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    addopts = cast(
        "list[str]",
        cast("dict[str, Any]", config["tool"])["pytest"]["ini_options"]["addopts"],
    )

    marker_expressions = [
        addopts[index + 1] for index, option in enumerate(addopts[:-1]) if option == "-m"
    ]

    assert marker_expressions == ["not integration"]


def test_integration_tests_are_marked_for_explicit_gate() -> None:
    missing_marker = [
        path.relative_to(TESTS_ROOT).as_posix()
        for path in sorted(INTEGRATION_ROOT.glob("test_*.py"))
        if "pytest.mark.integration" not in path.read_text(encoding="utf-8")
    ]

    assert missing_marker == []
