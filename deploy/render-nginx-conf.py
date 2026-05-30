#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


DEFAULT_TEMPLATE_PATH = Path("/etc/nginx/nginx.conf.template")
DEFAULT_OUTPUT_PATH = Path("/etc/nginx/nginx.conf")
DEFAULT_CANONICAL_HOST = "momo-result.ponta.me"
DEV_OPTIONAL_ORIGIN_LOCK_HOSTS = ("localhost", "127.0.0.1")
HOST_PATTERN = re.compile(r"^[A-Za-z0-9.-]+$")
ORIGIN_LOCK_TOKEN_MIN_LENGTH = 32
VALID_APP_ENVS = frozenset({"dev", "test", "prod"})


def nginx_quote(value: str) -> str:
    if any(ch in value for ch in "\r\n"):
        raise ValueError("nginx value must not contain newlines")
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def parse_hosts(raw: str) -> list[str]:
    hosts: list[str] = []
    for part in raw.split(","):
        host = part.strip().lower().rstrip(".")
        if not host:
            continue
        validate_host(host)
        if host not in hosts:
            hosts.append(host)
    return hosts


def validate_host(host: str) -> None:
    if len(host) > 253 or not HOST_PATTERN.fullmatch(host):
        raise ValueError(f"invalid host value: {host}")
    labels = host.split(".")
    if any(not is_valid_host_label(label) for label in labels):
        raise ValueError(f"invalid host value: {host}")


def is_valid_host_label(label: str) -> bool:
    if not 1 <= len(label) <= 63:
        return False
    return label[0].isalnum() and label[-1].isalnum()


def map_entries(hosts: list[str], value: int) -> str:
    return "\n".join(f"    {nginx_quote(host)} {value};" for host in hosts)


def validate_origin_lock_token(token: str, app_env: str) -> None:
    if app_env != "prod":
        return
    if len(token) < ORIGIN_LOCK_TOKEN_MIN_LENGTH:
        raise ValueError(
            "MOMO_ORIGIN_LOCK_TOKEN must be at least "
            f"{ORIGIN_LOCK_TOKEN_MIN_LENGTH} characters when APP_ENV=prod."
        )
    if not is_visible_ascii(token):
        raise ValueError(
            "MOMO_ORIGIN_LOCK_TOKEN must contain only visible ASCII characters "
            "when APP_ENV=prod."
        )


def validate_app_env(app_env: str) -> None:
    if app_env not in VALID_APP_ENVS:
        raise ValueError("APP_ENV must be one of: dev, test, prod.")


def is_visible_ascii(value: str) -> bool:
    return all(33 <= ord(char) <= 126 for char in value)


def main() -> int:
    app_env = os.environ.get("APP_ENV", "prod").lower()
    canonical_host = os.environ.get("MOMO_CANONICAL_HOST", DEFAULT_CANONICAL_HOST)
    extra_hosts = os.environ.get("MOMO_EXTRA_ALLOWED_HOSTS", "")
    token = os.environ.get("MOMO_ORIGIN_LOCK_TOKEN", "")
    template_path = Path(os.environ.get("MOMO_NGINX_TEMPLATE_PATH", str(DEFAULT_TEMPLATE_PATH)))
    output_path = Path(os.environ.get("MOMO_NGINX_OUTPUT_PATH", str(DEFAULT_OUTPUT_PATH)))

    try:
        validate_app_env(app_env)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    if not token:
        if app_env == "prod":
            print("MOMO_ORIGIN_LOCK_TOKEN is required when APP_ENV=prod.", file=sys.stderr)
            return 1
        token = "dev-origin-lock"
    try:
        validate_origin_lock_token(token, app_env)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    allowed_hosts = parse_hosts(",".join([canonical_host, extra_hosts]))
    if not allowed_hosts:
        print("MOMO_CANONICAL_HOST or MOMO_EXTRA_ALLOWED_HOSTS must define a host.", file=sys.stderr)
        return 1
    optional_origin_lock_hosts: list[str] = []
    if app_env != "prod":
        optional_origin_lock_hosts = parse_hosts(",".join(DEV_OPTIONAL_ORIGIN_LOCK_HOSTS))
        for host in optional_origin_lock_hosts:
            if host not in allowed_hosts:
                allowed_hosts.append(host)

    template = template_path.read_text(encoding="utf-8")
    rendered = (
        template.replace("__MOMO_ALLOWED_HOST_MAP_ENTRIES__", map_entries(allowed_hosts, 1))
        .replace(
            "__MOMO_OPTIONAL_ORIGIN_LOCK_HOST_MAP_ENTRIES__",
            map_entries(optional_origin_lock_hosts, 0),
        )
        .replace("__MOMO_ORIGIN_LOCK_TOKEN_VALUE__", nginx_quote(token))
    )
    output_path.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
