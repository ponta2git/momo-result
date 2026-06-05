from __future__ import annotations

import ast
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import cast

TESTS_ROOT = Path(__file__).resolve().parents[1]
OCR_WORKER_ROOT = TESTS_ROOT.parent
INTEGRATION_ROOT = TESTS_ROOT / "integration"
UNIT_ROOT = TESTS_ROOT / "unit"
EXTERNAL_RUNTIME_IMPORT_MODULES = {"redis", "psycopg_pool"}


def test_default_pytest_gate_excludes_external_integration_tests() -> None:
    addopts = _pytest_addopts()

    marker_expressions = [
        addopts[index + 1] for index, option in enumerate(addopts[:-1]) if option == "-m"
    ]

    assert marker_expressions == ["not integration"]


def test_coverage_gate_tracks_line_and_branch_baseline() -> None:
    coverage_config = _table(_tool_config(), "coverage")
    coverage_run = _table(coverage_config, "run")
    coverage_report = _table(coverage_config, "report")

    assert coverage_run["branch"] is True
    assert coverage_run["omit"] == [
        "src/momo_ocr/main.py",
        "src/momo_ocr/features/ocr_results/models.py",
        "src/momo_ocr/features/ocr_results/ranked_rows.py",
    ]
    assert coverage_run["source"] == ["momo_ocr"]
    assert coverage_report["fail_under"] == 88.2
    assert coverage_report["show_missing"] is True
    assert coverage_report["skip_covered"] is True


def test_integration_tests_are_marked_for_explicit_gate() -> None:
    missing_marker = [
        path.relative_to(TESTS_ROOT).as_posix()
        for path in sorted(INTEGRATION_ROOT.glob("test_*.py"))
        if not _module_has_integration_marker(path)
    ]

    assert missing_marker == []


def test_unit_tests_keep_external_runtime_imports_out_of_default_gate() -> None:
    blocked_imports = [
        f"{path.relative_to(TESTS_ROOT).as_posix()}: {import_name}"
        for path in sorted(UNIT_ROOT.rglob("test_*.py"))
        for import_name in _external_runtime_imports(path)
    ]

    assert blocked_imports == []


def _pytest_addopts() -> list[str]:
    pytest_config = _table(_tool_config(), "pytest")
    ini_options = _table(pytest_config, "ini_options")
    addopts = ini_options["addopts"]
    assert isinstance(addopts, list)
    assert all(isinstance(option, str) for option in addopts)
    return cast("list[str]", addopts)


def _tool_config() -> Mapping[str, object]:
    config = tomllib.loads((OCR_WORKER_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    tool_config = config["tool"]
    assert isinstance(tool_config, Mapping)
    return cast("Mapping[str, object]", tool_config)


def _table(parent: Mapping[str, object], key: str) -> Mapping[str, object]:
    value = parent[key]
    assert isinstance(value, Mapping)
    return cast("Mapping[str, object]", value)


def _module_has_integration_marker(path: Path) -> bool:
    module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return any(_has_pytest_mark_integration(node) for node in ast.walk(module))


def _has_pytest_mark_integration(node: ast.AST) -> bool:
    if not isinstance(node, ast.Attribute) or node.attr != "integration":
        return False
    mark = node.value
    return (
        isinstance(mark, ast.Attribute)
        and mark.attr == "mark"
        and isinstance(mark.value, ast.Name)
        and mark.value.id == "pytest"
    )


def _external_runtime_imports(path: Path) -> list[str]:
    module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: list[str] = []
    for node in ast.walk(module):
        if isinstance(node, ast.Import):
            imports.extend(
                alias.name for alias in node.names if _is_external_runtime_module(alias.name)
            )
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if _is_external_runtime_module(module_name):
                imports.append(module_name)
    return imports


def _is_external_runtime_module(module_name: str) -> bool:
    return module_name in EXTERNAL_RUNTIME_IMPORT_MODULES or module_name.startswith(
        "testcontainers"
    )
