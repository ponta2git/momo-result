#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from typing import TextIO
from urllib.request import Request, urlopen

HTTP_OK = 200
SAFE_HOST = re.compile(r"^[A-Za-z0-9.-]{1,253}$")


class PublicEdgeContractError(RuntimeError):
    pass


def _valid_health_payload(payload: object) -> bool:
    return isinstance(payload, dict) and payload.get("status") == "ok"


def probe_public_edge(host: str) -> None:
    if not SAFE_HOST.fullmatch(host):
        raise PublicEdgeContractError

    headers = {
        "Accept": "application/json",
        "User-Agent": "momo-result-release-probe/1",
    }
    with urlopen(
        Request(f"https://{host}/healthz", headers=headers), timeout=10
    ) as response:
        if response.status != HTTP_OK or not _valid_health_payload(json.load(response)):
            raise PublicEdgeContractError


def _write_json(payload: dict[str, object], *, stream: TextIO) -> None:
    json.dump(payload, stream, separators=(",", ":"), sort_keys=True)
    stream.write("\n")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        _write_json(
            {
                "event": "runtime_public_edge_smoke",
                "status": "failed",
                "errorKind": "InvalidArguments",
            },
            stream=sys.stderr,
        )
        return 2

    try:
        probe_public_edge(argv[1])
    except Exception as error:  # noqa: BLE001 - expose only the safe exception class.
        _write_json(
            {
                "event": "runtime_public_edge_smoke",
                "status": "failed",
                "errorKind": type(error).__name__,
            },
            stream=sys.stderr,
        )
        return 1

    _write_json(
        {
            "event": "runtime_public_edge_smoke",
            "schemaVersion": 1,
            "status": "ok",
        },
        stream=sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
