#!/usr/bin/env python3
# ruff: noqa: PT009 - this standalone test intentionally uses unittest assertions.
from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        message = f"Unable to load {path.name}"
        raise RuntimeError(message)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


postdeploy_contract = load_module(
    "runtime_postdeploy_contract", ROOT / "scripts/ci/runtime-postdeploy-contract.py"
)
log_summary = load_module(
    "runtime_log_summary", ROOT / "scripts/ci/summarize-runtime-logs.py"
)


class RuntimeEvidenceScriptTest(unittest.TestCase):
    def test_postdeploy_evidence_contract_supports_rollback_generations(self) -> None:
        legacy_payload = {
            "event": "runtime_postdeploy_smoke",
            "status": "ok",
            "checks": ["database", "http", "processes", "redis", "web"],
        }
        current_payload = {
            **legacy_payload,
            "schemaVersion": 1,
            "checks": [
                "database",
                "http",
                "processes",
                "publicEdge",
                "redis",
                "web",
            ],
        }

        postdeploy_contract.validate_postdeploy_evidence(legacy_payload)
        postdeploy_contract.validate_postdeploy_evidence(
            current_payload, {"publicEdge"}
        )
        with self.assertRaises(postdeploy_contract.PostdeployContractError):
            postdeploy_contract.validate_postdeploy_evidence(
                legacy_payload, {"publicEdge"}
            )
        with self.assertRaises(postdeploy_contract.PostdeployContractError):
            postdeploy_contract.validate_postdeploy_evidence(
                {**legacy_payload, "checks": ["database", "database"]}
            )
        with self.assertRaises(postdeploy_contract.PostdeployContractError):
            postdeploy_contract.validate_postdeploy_evidence(
                {**current_payload, "schemaVersion": 2}
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            evidence_path = Path(temp_dir) / "postdeploy.json"
            evidence_path.write_text(json.dumps(current_payload), encoding="utf-8")
            success_output = io.StringIO()
            with mock.patch.object(sys, "stdout", success_output):
                result = postdeploy_contract.main(
                    [
                        "runtime-postdeploy-contract",
                        str(evidence_path),
                        "--require-check",
                        "publicEdge",
                    ]
                )
        self.assertEqual(result, 0)
        self.assertEqual(
            json.loads(success_output.getvalue()),
            {"schemaVersion": 1, "status": "ok"},
        )

    def test_runtime_log_summary_drops_messages_and_unstructured_lines(self) -> None:
        sensitive_value = "sensitive-value-that-must-not-appear"
        summary = log_summary.summarize(
            [
                json.dumps(
                    {
                        "app": "momo-result-api",
                        "level": "ERROR",
                        "message": sensitive_value,
                        "exception_classes": ["RuntimeException"],
                    }
                ),
                f"unstructured {sensitive_value}",
            ]
        )
        encoded = json.dumps(summary, sort_keys=True)
        self.assertNotIn(sensitive_value, encoded)
        self.assertEqual(summary["unstructuredLineCount"], 1)
        self.assertEqual(summary["exceptionClasses"], {"RuntimeException": 1})


if __name__ == "__main__":
    result = unittest.main(exit=False)
    if not result.result.wasSuccessful():
        raise SystemExit(1)
    sys.stdout.write("Runtime evidence script tests passed.\n")
