#!/usr/bin/env python3
# ruff: noqa: PT009 - this standalone test intentionally uses unittest assertions.
from __future__ import annotations

import importlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy"))
CHARACTERIZATION_FIXTURE = json.loads(
    (ROOT / "contracts/runtime-tool-characterization-v1.json").read_text(encoding="utf-8")
)


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        message = f"Unable to load {path.name}"
        raise RuntimeError(message)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load_module("release_preflight", ROOT / "deploy/release-preflight.py")
public_edge = importlib.import_module("public_edge_probe")
postdeploy = load_module("postdeploy_smoke", ROOT / "deploy/postdeploy-smoke.py")
postdeploy_contract = load_module(
    "runtime_postdeploy_contract", ROOT / "scripts/ci/runtime-postdeploy-contract.py"
)
log_summary = load_module("runtime_log_summary", ROOT / "scripts/ci/summarize-runtime-logs.py")


class RuntimeDeployScriptTest(unittest.TestCase):
    def test_preflight_characterization_fixture(self) -> None:
        for case in CHARACTERIZATION_FIXTURE["preflight"]:
            with self.subTest(case=case["name"]):
                columns = set(preflight.REQUIRED_COLUMNS)
                if removed := case["removedColumn"]:
                    table, column = removed.split(".", maxsplit=1)
                    columns.remove((table, column))
                missing = preflight.missing_contract(
                    columns=columns,
                    tables=preflight.REQUIRED_TABLES,
                    indexes=preflight.REQUIRED_INDEXES,
                    hardened_functions=preflight.REQUIRED_FUNCTIONS,
                    member_ids=preflight.REQUIRED_MEMBER_IDS,
                )
                self.assertEqual(
                    {key: len(value) for key, value in missing.items()},
                    case["expectedMissingCounts"],
                )

    def test_render_nginx_characterization_fixture(self) -> None:
        for case in CHARACTERIZATION_FIXTURE["renderNginx"]:
            with self.subTest(case=case["name"]):
                try:
                    preflight_status = "ok"
                    render_nginx = load_module(
                        f"render_nginx_conf_{case['name']}",
                        ROOT / "deploy/render-nginx-conf.py",
                    )
                    render_nginx.validate_app_env(case["appEnv"])
                    token = case["originLockToken"]
                    if not token:
                        if case["appEnv"] == "prod":
                            raise ValueError
                        token = "dev-origin-lock"
                    render_nginx.validate_origin_lock_token(token, case["appEnv"])
                    allowed = render_nginx.parse_hosts(
                        ",".join([case["canonicalHost"], case["extraAllowedHosts"]])
                    )
                    optional: list[str] = []
                    if case["appEnv"] != "prod":
                        optional = render_nginx.parse_hosts(
                            ",".join(render_nginx.DEV_OPTIONAL_ORIGIN_LOCK_HOSTS)
                        )
                        for host in optional:
                            if host not in allowed:
                                allowed.append(host)
                except (OSError, ValueError):
                    preflight_status = "failed"
                    allowed = []
                    optional = []

                self.assertEqual(preflight_status, case["expectedStatus"])
                if preflight_status == "ok":
                    self.assertEqual(allowed, case["expectedAllowedHosts"])
                    self.assertEqual(optional, case["expectedOptionalOriginLockHosts"])

    def test_postdeploy_process_and_health_contracts_fail_closed(self) -> None:
        smoke_fixture = CHARACTERIZATION_FIXTURE["smoke"]
        for case in smoke_fixture["processCases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(
                    postdeploy.missing_processes(case["commandLines"]),
                    case["expectedMissing"],
                )
        for case in smoke_fixture["healthPayloadCases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(
                    postdeploy.valid_health_payload(case["payload"]),
                    case["expectedValid"],
                )
        for case in smoke_fixture["checkCases"]:
            with self.subTest(mode=case["mode"]):
                self.assertEqual(
                    postdeploy.postdeploy_checks(case["mode"]),
                    case["expectedChecks"],
                )
        with self.assertRaises(ValueError):
            postdeploy.postdeploy_checks("disabled")

        class FakeHttpResponse(io.BytesIO):
            def __init__(self, payload: bytes, status: int = 200) -> None:
                super().__init__(payload)
                self.status = status

        with mock.patch.object(
            public_edge,
            "urlopen",
            return_value=FakeHttpResponse(b'{"status":"ok"}'),
        ) as public_request:
            public_edge.probe_public_edge("example.com")
        request = public_request.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.com/healthz")
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(
            request.get_header("User-agent"), "momo-result-release-probe/1"
        )
        self.assertEqual(public_request.call_args.kwargs, {"timeout": 10})

        with (
            mock.patch.object(
                public_edge,
                "urlopen",
                return_value=FakeHttpResponse(b'{"status":"degraded"}'),
            ),
            self.assertRaises(public_edge.PublicEdgeContractError),
        ):
            public_edge.probe_public_edge("example.com")

        success_output = io.StringIO()
        with (
            mock.patch.object(public_edge, "probe_public_edge") as probe,
            mock.patch.object(sys, "stdout", success_output),
        ):
            self.assertEqual(public_edge.main(["public-edge-probe", "example.com"]), 0)
        probe.assert_called_once_with("example.com")
        self.assertEqual(
            json.loads(success_output.getvalue()),
            {
                "event": "runtime_public_edge_smoke",
                "schemaVersion": 1,
                "status": "ok",
            },
        )

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

    def test_database_probes_use_transaction_local_timeouts(self) -> None:
        class FakeCursor:
            def __init__(self) -> None:
                self.commands: list[str] = []

            def __enter__(self) -> FakeCursor:
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def execute(self, command: str, *_args: object) -> None:
                self.commands.append(command)

            def fetchall(self) -> list[tuple[object, ...]]:
                return []

            def fetchone(self) -> tuple[int]:
                return (1,)

        class FakeConnection:
            def __init__(self) -> None:
                self.fake_cursor = FakeCursor()

            def __enter__(self) -> FakeConnection:
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def cursor(self) -> FakeCursor:
                return self.fake_cursor

        preflight_connection = FakeConnection()
        preflight._inspect_contract(preflight_connection)
        self.assertEqual(
            preflight_connection.fake_cursor.commands[:3],
            [
                "SET TRANSACTION READ ONLY",
                "SET LOCAL statement_timeout = 10000",
                "SET LOCAL lock_timeout = 3000",
            ],
        )

        connect_calls: list[dict[str, object]] = []
        postdeploy_connection = FakeConnection()
        fake_psycopg = ModuleType("psycopg")

        def connect(_database_url: str, **kwargs: object) -> FakeConnection:
            connect_calls.append(kwargs)
            return postdeploy_connection

        fake_psycopg.connect = connect  # type: ignore[attr-defined]
        with mock.patch.dict(sys.modules, {"psycopg": fake_psycopg}):
            postdeploy._database_probe("postgresql://example.invalid/database")
        self.assertNotIn("options", connect_calls[0])
        self.assertEqual(
            postdeploy_connection.fake_cursor.commands,
            [
                "SET TRANSACTION READ ONLY",
                "SET LOCAL statement_timeout = 5000",
                "SELECT 1",
            ],
        )

        preflight_connect_calls: list[dict[str, object]] = []
        fake_preflight_connection = FakeConnection()

        def preflight_connect(_database_url: str, **kwargs: object) -> FakeConnection:
            preflight_connect_calls.append(kwargs)
            return fake_preflight_connection

        fake_psycopg.connect = preflight_connect  # type: ignore[attr-defined]
        empty_contract = {
            "columns": [],
            "tables": [],
            "indexes": [],
            "functions": [],
            "seedMembers": [],
        }
        with (
            mock.patch.dict(
                os.environ,
                {"DATABASE_URL": "postgresql://example.invalid/database"},
                clear=True,
            ),
            mock.patch.dict(sys.modules, {"psycopg": fake_psycopg}),
            mock.patch.object(preflight, "_inspect_contract", return_value=empty_contract),
            mock.patch.object(preflight, "_write_json"),
        ):
            self.assertEqual(preflight.main(), 0)
        self.assertNotIn("options", preflight_connect_calls[0])

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
