#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CHECK_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")
CORE_CHECKS = frozenset({"database", "http", "processes", "redis", "web"})


class PostdeployContractError(RuntimeError):
    pass


def validate_postdeploy_evidence(
    payload: object, additional_required_checks: set[str] | None = None
) -> None:
    if not isinstance(payload, dict):
        raise PostdeployContractError("InvalidPayload")
    if payload.get("event") != "runtime_postdeploy_smoke":
        raise PostdeployContractError("InvalidEvent")
    if payload.get("schemaVersion") not in (None, 1):
        raise PostdeployContractError("UnsupportedSchemaVersion")
    if payload.get("status") != "ok":
        raise PostdeployContractError("UnhealthyStatus")

    checks = payload.get("checks")
    if not isinstance(checks, list) or not all(
        isinstance(check, str) and CHECK_NAME.fullmatch(check) for check in checks
    ):
        raise PostdeployContractError("InvalidChecks")
    if len(checks) != len(set(checks)):
        raise PostdeployContractError("DuplicateChecks")

    required = CORE_CHECKS | (additional_required_checks or set())
    if not required.issubset(checks):
        raise PostdeployContractError("MissingRequiredChecks")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--require-check", action="append", default=[])
    args = parser.parse_args(argv[1:])

    try:
        if not all(CHECK_NAME.fullmatch(check) for check in args.require_check):
            raise PostdeployContractError("InvalidRequiredCheck")
        with args.evidence.open(encoding="utf-8") as stream:
            payload = json.load(stream)
        validate_postdeploy_evidence(payload, set(args.require_check))
    except (OSError, json.JSONDecodeError, PostdeployContractError) as error:
        error_kind = (
            str(error)
            if isinstance(error, PostdeployContractError)
            else type(error).__name__
        )
        print(
            json.dumps(
                {
                    "event": "runtime_postdeploy_evidence_validation",
                    "status": "failed",
                    "errorKind": error_kind,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    print('{"schemaVersion":1,"status":"ok"}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
