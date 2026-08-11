#!/opt/momo-result/ocr-worker/.venv/bin/python
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

EXPECTED_PROCESSES = {
    "api": ("/opt/java/openjdk/bin/java", "/opt/momo-result/api/lib/", "momo.api.Main"),
    "nginx": ("/usr/sbin/nginx",),
    "ocrWorker": ("/opt/momo-result/ocr-worker/.venv/bin/momo-ocr", "worker"),
}
SAFE_HOST = re.compile(r"^[A-Za-z0-9.-]{1,253}$")
HTTP_OK = 200


class HealthContractError(RuntimeError):
    pass


class WebContractError(RuntimeError):
    pass


class PublicEdgeContractError(RuntimeError):
    pass


class DatabaseContractError(RuntimeError):
    pass


class RedisContractError(RuntimeError):
    pass


def missing_processes(command_lines: list[str]) -> list[str]:
    return sorted(
        name
        for name, markers in EXPECTED_PROCESSES.items()
        if not any(
            all(marker in command_line for marker in markers) for command_line in command_lines
        )
    )


def valid_health_payload(payload: object) -> bool:
    return isinstance(payload, dict) and payload.get("status") == "ok"


def _process_command_lines() -> list[str]:
    command_lines: list[str] = []
    for proc_dir in Path("/proc").iterdir():
        if not proc_dir.name.isdigit():
            continue
        try:
            raw = (proc_dir / "cmdline").read_bytes()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        command_lines.append(raw.replace(b"\0", b" ").decode("utf-8", errors="replace"))
    return command_lines


def _http_probe(host: str, origin_token: str) -> None:
    headers = {"Host": host, "X-Momo-Origin-Lock": origin_token}
    with urlopen(Request("http://127.0.0.1:8080/healthz", headers=headers), timeout=5) as response:
        if response.status != HTTP_OK or not valid_health_payload(json.load(response)):
            raise HealthContractError
    with urlopen(Request("http://127.0.0.1:8080/", headers=headers), timeout=5) as response:
        body = response.read(131_072)
        if response.status != HTTP_OK or b'<div id="root"></div>' not in body:
            raise WebContractError


def _public_edge_probe(host: str) -> None:
    headers = {
        "Accept": "application/json",
        "User-Agent": "momo-result-release-probe/1",
    }
    with urlopen(
        Request(f"https://{host}/healthz", headers=headers), timeout=10
    ) as response:
        if response.status != HTTP_OK or not valid_health_payload(json.load(response)):
            raise PublicEdgeContractError


def _database_probe(database_url: str) -> None:
    import psycopg  # noqa: PLC0415 - only the packaged runtime owns this dependency.

    with (
        psycopg.connect(
            database_url,
            connect_timeout=5,
            application_name="momo-result-postdeploy-smoke",
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute("SET TRANSACTION READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = 5000")
        cursor.execute("SELECT 1")
        if cursor.fetchone() != (1,):
            raise DatabaseContractError


def _redis_probe(redis_url: str) -> None:
    import redis  # noqa: PLC0415 - only the packaged runtime owns this dependency.

    client = redis.Redis.from_url(
        redis_url,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    try:
        if client.ping() is not True:
            raise RedisContractError
    finally:
        client.close()


def main() -> int:
    database_url = os.environ.get("DATABASE_URL", "")
    redis_url = os.environ.get("REDIS_URL", "")
    origin_token = os.environ.get("MOMO_ORIGIN_LOCK_TOKEN", "")
    host = os.environ.get("MOMO_CANONICAL_HOST", "momo-result.ponta.me")
    if not database_url or not redis_url or not origin_token or not SAFE_HOST.fullmatch(host):
        _write_failure("MissingOrInvalidConfiguration")
        return 1

    try:
        _http_probe(host, origin_token)
        _public_edge_probe(host)
        _database_probe(database_url)
        _redis_probe(redis_url)
        missing = missing_processes(_process_command_lines())
        if missing:
            _write_failure("MissingRuntimeProcess", missing=missing)
            return 1
        _write_json(
            {
                "event": "runtime_postdeploy_smoke",
                "status": "ok",
                "checks": [
                    "database",
                    "http",
                    "processes",
                    "publicEdge",
                    "redis",
                    "web",
                ],
            },
            stream=sys.stdout,
        )
    except Exception as error:  # noqa: BLE001 - emit only the safe exception class at this boundary.
        _write_failure(type(error).__name__)
        return 1
    else:
        return 0


def _write_failure(error_class: str, *, missing: list[str] | None = None) -> None:
    payload: dict[str, object] = {
        "event": "runtime_postdeploy_smoke",
        "status": "failed",
        "errorClass": error_class if error_class.isidentifier() else "UnknownError",
    }
    if missing:
        payload["missingProcesses"] = missing
    _write_json(payload, stream=sys.stderr)


def _write_json(payload: dict[str, object], *, stream: object) -> None:
    stream.write(json.dumps(payload, separators=(",", ":"), sort_keys=True))  # type: ignore[attr-defined]
    stream.write("\n")  # type: ignore[attr-defined]


if __name__ == "__main__":
    raise SystemExit(main())
