#!/usr/bin/env python3
# ruff: noqa: PT009 - this standalone test intentionally uses unittest assertions.
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        message = f"Unable to load {path.name}"
        raise RuntimeError(message)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load_module("release_preflight", ROOT / "deploy/release-preflight.py")
postdeploy = load_module("postdeploy_smoke", ROOT / "deploy/postdeploy-smoke.py")
log_summary = load_module("runtime_log_summary", ROOT / "scripts/ci/summarize-runtime-logs.py")


class RuntimeDeployScriptTest(unittest.TestCase):
    def test_complete_contract_passes_and_missing_column_fails(self) -> None:
        complete = preflight.missing_contract(
            columns=preflight.REQUIRED_COLUMNS,
            tables=preflight.REQUIRED_TABLES,
            indexes=preflight.REQUIRED_INDEXES,
            hardened_functions=preflight.REQUIRED_FUNCTIONS,
            member_ids=preflight.REQUIRED_MEMBER_IDS,
        )
        self.assertFalse(any(complete.values()), complete)

        missing = preflight.missing_contract(
            columns=preflight.REQUIRED_COLUMNS - {("ocr_jobs", "status")},
            tables=preflight.REQUIRED_TABLES,
            indexes=preflight.REQUIRED_INDEXES,
            hardened_functions=preflight.REQUIRED_FUNCTIONS,
            member_ids=preflight.REQUIRED_MEMBER_IDS,
        )
        self.assertEqual(missing["columns"], ["ocr_jobs.status"])

    def test_postdeploy_process_and_health_contracts_fail_closed(self) -> None:
        commands = [
            "/opt/java/openjdk/bin/java -cp /opt/momo-result/api/lib/app.jar momo.api.Main",
            "/usr/sbin/nginx -c /tmp/nginx.conf",
            "/opt/momo-result/ocr-worker/.venv/bin/python "
            "/opt/momo-result/ocr-worker/.venv/bin/momo-ocr worker",
        ]
        self.assertEqual(postdeploy.missing_processes(commands), [])
        self.assertEqual(postdeploy.missing_processes(commands[:-1]), ["ocrWorker"])
        self.assertTrue(postdeploy.valid_health_payload({"status": "ok"}))
        self.assertFalse(postdeploy.valid_health_payload({"status": "degraded"}))

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
    sys.stdout.write("Runtime deployment script tests passed.\n")
