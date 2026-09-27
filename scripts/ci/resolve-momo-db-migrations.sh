#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "resolve-momo-db-migrations.sh accepts no positional arguments." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# An explicit source is intentional (for example, a pinned archive or a schema
# development fixture). Never silently replace it with a different checkout.
if [[ -n "${MOMO_DB_MIGRATIONS_DIR:-}" ]]; then
  if [[ ! -d "${MOMO_DB_MIGRATIONS_DIR}" ]]; then
    echo "momo-db migrations directory was not found: ${MOMO_DB_MIGRATIONS_DIR}" >&2
    exit 1
  fi
  (cd "${MOMO_DB_MIGRATIONS_DIR}" && pwd -P)
  exit 0
fi

revision="$(tr -d '\r\n' < "${repo_root}/.momo-db-ref")"
if [[ ! "${revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid .momo-db-ref." >&2
  exit 1
fi

for candidate in "${repo_root}/_deps/momo-db/drizzle" "${repo_root}/../momo-db/drizzle"; do
  [[ -d "${candidate}" ]] || continue
  checkout="$(cd "${candidate}/.." && pwd -P)"
  if [[ "$(git -C "${checkout}" rev-parse --show-toplevel 2>/dev/null)" != "${checkout}" ]] ||
    ! git -C "${checkout}" cat-file -e "${revision}^{commit}" 2>/dev/null; then
    echo "The default momo-db checkout does not contain the pinned revision. Fetch it or set MOMO_DB_MIGRATIONS_DIR explicitly." >&2
    exit 1
  fi
  # These index flags suppress working-tree comparisons, including missing SQL
  # in a sparse checkout. A default source must be fully materialized and checked.
  if [[ -n "$(git -C "${checkout}" ls-files -v -- drizzle | LC_ALL=C sed -n '/^[a-zS] /p')" ]]; then
    echo "The default momo-db checkout hides migration files from Git comparison. Clear skip-worktree/assume-unchanged flags or set MOMO_DB_MIGRATIONS_DIR explicitly." >&2
    exit 1
  fi
  if ! git -C "${checkout}" diff --quiet "${revision}" -- drizzle ||
    [[ -n "$(git -C "${checkout}" ls-files --others -- 'drizzle/*.sql' 'drizzle/meta/*')" ]]; then
    echo "momo-db migrations differ from .momo-db-ref. Select the pinned migrations or set MOMO_DB_MIGRATIONS_DIR explicitly for an intentional schema experiment." >&2
    exit 1
  fi
  (cd "${candidate}" && pwd -P)
  exit 0
done

echo "momo-db migrations directory was not found. Set MOMO_DB_MIGRATIONS_DIR to the intended migration source." >&2
exit 1
