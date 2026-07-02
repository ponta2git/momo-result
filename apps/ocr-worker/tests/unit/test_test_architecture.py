from __future__ import annotations

import ast
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import cast

TESTS_ROOT = Path(__file__).resolve().parents[1]
OCR_WORKER_ROOT = TESTS_ROOT.parent
SOURCE_ROOT = OCR_WORKER_ROOT / "src" / "momo_ocr"
INTEGRATION_ROOT = TESTS_ROOT / "integration"
UNIT_ROOT = TESTS_ROOT / "unit"
EXTERNAL_RUNTIME_IMPORT_MODULES = {"redis", "psycopg_pool"}
MAX_SOURCE_MODULE_LINES = 299
MAX_CONTROL_NESTING = 2


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


def test_source_modules_stay_below_refactor_size_limit() -> None:
    oversized_modules = [
        f"{path.relative_to(OCR_WORKER_ROOT).as_posix()}: {line_count} lines"
        for path in _source_python_files()
        if (line_count := _source_line_count(path)) > MAX_SOURCE_MODULE_LINES
    ]

    assert oversized_modules == []


def test_source_control_flow_avoids_deep_nesting() -> None:
    deep_blocks = [
        f"{path.relative_to(OCR_WORKER_ROOT).as_posix()}:{line} {kind} depth={depth}"
        for path in _source_python_files()
        for line, kind, depth in _deep_control_blocks(path)
    ]

    assert deep_blocks == []


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


def _source_python_files() -> list[Path]:
    return sorted(path for path in SOURCE_ROOT.rglob("*.py") if "__pycache__" not in path.parts)


def _source_line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def _deep_control_blocks(path: Path) -> list[tuple[int, str, int]]:
    module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    visitor = _ControlNestingVisitor()
    visitor.visit_module(module)
    return visitor.issues


class _ControlNestingVisitor:
    def __init__(self) -> None:
        self.issues: list[tuple[int, str, int]] = []

    def visit_module(self, module: ast.Module) -> None:
        self._visit_body(module.body, depth=0)

    def _visit_body(self, statements: list[ast.stmt], *, depth: int) -> None:
        for statement in statements:
            self._visit_statement(statement, depth=depth)

    def _visit_statement(self, statement: ast.stmt, *, depth: int) -> None:  # noqa: PLR0911
        if isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            self._visit_body(statement.body, depth=0)
            return
        if isinstance(statement, ast.If):
            self._visit_if(statement, depth=depth)
            return
        if isinstance(statement, ast.For | ast.AsyncFor | ast.While):
            self._visit_loop(statement, depth=depth)
            return
        if isinstance(statement, ast.With | ast.AsyncWith):
            self._visit_block(statement.body, statement, depth=depth)
            return
        if isinstance(statement, ast.Try):
            self._visit_try(statement, depth=depth)
            return
        if isinstance(statement, ast.Match):
            self._visit_match(statement, depth=depth)
            return

    def _visit_if(self, statement: ast.If, *, depth: int) -> None:
        next_depth = self._record(statement, depth=depth)
        self._visit_body(statement.body, depth=next_depth)
        if len(statement.orelse) == 1 and isinstance(statement.orelse[0], ast.If):
            self._visit_if(statement.orelse[0], depth=depth)
            return
        self._visit_body(statement.orelse, depth=next_depth)

    def _visit_loop(
        self,
        statement: ast.For | ast.AsyncFor | ast.While,
        *,
        depth: int,
    ) -> None:
        next_depth = self._record(statement, depth=depth)
        self._visit_body(statement.body, depth=next_depth)
        self._visit_body(statement.orelse, depth=next_depth)

    def _visit_block(
        self,
        body: list[ast.stmt],
        statement: ast.With | ast.AsyncWith,
        *,
        depth: int,
    ) -> None:
        next_depth = self._record(statement, depth=depth)
        self._visit_body(body, depth=next_depth)

    def _visit_try(self, statement: ast.Try, *, depth: int) -> None:
        next_depth = self._record(statement, depth=depth)
        self._visit_body(statement.body, depth=next_depth)
        for handler in statement.handlers:
            self._visit_body(handler.body, depth=next_depth)
        self._visit_body(statement.orelse, depth=next_depth)
        self._visit_body(statement.finalbody, depth=next_depth)

    def _visit_match(self, statement: ast.Match, *, depth: int) -> None:
        next_depth = self._record(statement, depth=depth)
        for case in statement.cases:
            self._visit_body(case.body, depth=next_depth)

    def _record(self, statement: ast.stmt, *, depth: int) -> int:
        next_depth = depth + 1
        if next_depth > MAX_CONTROL_NESTING:
            self.issues.append((statement.lineno, type(statement).__name__, next_depth))
        return next_depth
