from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

POSTGRES_PASSWORD = "test"  # noqa: S105
_STATEMENT_BREAKPOINT = "--> statement-breakpoint"


@contextmanager
def migrated_postgres_conninfo() -> Iterator[str]:
    container = PostgresContainer(
        "postgres:16-alpine",
        username="test",
        password=POSTGRES_PASSWORD,
        dbname="test",
        driver=None,
    )
    try:
        container.start()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Docker is not available for Postgres Testcontainer: {exc}")
    try:
        conninfo = f"{container.get_connection_url(driver=None)}?sslmode=disable"
        apply_momo_db_migrations(conninfo)
        yield conninfo
    finally:
        container.stop()


def apply_momo_db_migrations(conninfo: str) -> None:
    migration_files = sorted(_migrations_dir().glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if not migration_files:
        msg = "No momo-db migration SQL files found."
        raise RuntimeError(msg)

    with psycopg.connect(conninfo, autocommit=True) as conn:
        for path in migration_files:
            for statement in _migration_statements(path):
                try:
                    conn.execute(statement)
                except Exception as exc:
                    msg = f"Failed to apply momo-db migration {path.name}"
                    raise RuntimeError(msg) from exc


def _migration_statements(path: Path) -> Iterator[str]:
    for statement in path.read_text().split(_STATEMENT_BREAKPOINT):
        stripped = statement.strip()
        if stripped:
            yield stripped


def _migrations_dir() -> Path:
    candidates = _migration_dir_candidates()
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    searched = ", ".join(str(candidate) for candidate in candidates)
    msg = (
        "momo-db migrations directory was not found. "
        f"Set MOMO_DB_MIGRATIONS_DIR. Searched: {searched}"
    )
    raise RuntimeError(msg)


def _migration_dir_candidates() -> list[Path]:
    here = Path(__file__).resolve()
    repo_root = here.parents[4]
    cwd = Path.cwd().resolve()
    migrations_dir = os.environ.get("MOMO_DB_MIGRATIONS_DIR")
    explicit = [Path(migrations_dir).resolve()] if migrations_dir else []
    return [
        *explicit,
        (cwd / "../../_deps/momo-db/drizzle").resolve(),
        (cwd / "../../../momo-db/drizzle").resolve(),
        repo_root / "_deps/momo-db/drizzle",
        repo_root.parent / "momo-db/drizzle",
    ]
