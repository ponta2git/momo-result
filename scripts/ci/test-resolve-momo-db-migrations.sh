#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf -- "${fixture_root}"' EXIT
fixture_root="$(cd "${fixture_root}" && pwd -P)"
app="${fixture_root}/momo-result"
database="${fixture_root}/momo-db"
mkdir -p "${app}/scripts/ci" "${database}/drizzle"
cp "${repo_root}/scripts/ci/resolve-momo-db-migrations.sh" "${app}/scripts/ci/"
resolver="${app}/scripts/ci/resolve-momo-db-migrations.sh"
git init --quiet "${database}"
git -C "${database}" config user.email fixture@example.invalid
git -C "${database}" config user.name Fixture
printf 'SELECT 1;\n' > "${database}/drizzle/0000_initial.sql"
git -C "${database}" add drizzle
git -C "${database}" commit --quiet -m baseline
git -C "${database}" rev-parse HEAD > "${app}/.momo-db-ref"

resolve_default() { env -u MOMO_DB_MIGRATIONS_DIR bash "${resolver}"; }
reject_default() {
  local name="$1"
  if resolve_default > "${fixture_root}/output" 2>&1; then
    echo "Migration resolver accepted ${name}." >&2
    exit 1
  fi
}

test "$(resolve_default)" = "${database}/drizzle"

# Git's index can hide modified or missing files from a normal diff.
git -C "${database}" update-index --skip-worktree drizzle/0000_initial.sql
printf 'SELECT 99;\n' > "${database}/drizzle/0000_initial.sql"
reject_default skip-worktree-modification
grep -Fq 'hides migration files from Git comparison' "${fixture_root}/output"
rm "${database}/drizzle/0000_initial.sql"
reject_default skip-worktree-missing-file
git -C "${database}" update-index --no-skip-worktree drizzle/0000_initial.sql
git -C "${database}" checkout -- drizzle/0000_initial.sql
git -C "${database}" update-index --assume-unchanged drizzle/0000_initial.sql
printf 'SELECT 99;\n' > "${database}/drizzle/0000_initial.sql"
reject_default assume-unchanged-modification
git -C "${database}" update-index --no-assume-unchanged drizzle/0000_initial.sql
git -C "${database}" checkout -- drizzle/0000_initial.sql
test "$(resolve_default)" = "${database}/drizzle"

# Other repository work may advance HEAD without changing the consumed schema.
printf 'Unrelated documentation.\n' > "${database}/README.md"
git -C "${database}" add README.md
git -C "${database}" commit --quiet -m documentation
test "$(resolve_default)" = "${database}/drizzle"

printf 'SELECT 2;\n' >> "${database}/drizzle/0000_initial.sql"
reject_default dirty-migration
grep -Fq 'migrations differ from .momo-db-ref' "${fixture_root}/output"
git -C "${database}" add drizzle
git -C "${database}" commit --quiet -m changed-schema
reject_default different-committed-schema
git -C "${database}" rev-parse HEAD > "${app}/.momo-db-ref"
test "$(resolve_default)" = "${database}/drizzle"

# Ignored SQL is still picked up by the bootstrap's file glob.
printf '*.sql\n' > "${database}/.gitignore"
printf 'SELECT 3;\n' > "${database}/drizzle/0001_untracked.sql"
reject_default ignored-untracked-migration
rm "${database}/drizzle/0001_untracked.sql"

mkdir -p "${app}/_deps"
git clone --quiet --no-hardlinks "${database}" "${app}/_deps/momo-db"
test "$(resolve_default)" = "${app}/_deps/momo-db/drizzle"
printf 'SELECT 4;\n' >> "${app}/_deps/momo-db/drizzle/0000_initial.sql"
reject_default mismatched-preferred-checkout

# Explicit archives need no git metadata; an invalid explicit path must not fall back.
explicit="${fixture_root}/intended migration snapshot"
mkdir "${explicit}"
test "$(MOMO_DB_MIGRATIONS_DIR="${explicit}" bash "${resolver}")" = "${explicit}"
if MOMO_DB_MIGRATIONS_DIR="${fixture_root}/missing" bash "${resolver}" > "${fixture_root}/output" 2>&1; then
  echo "Migration resolver replaced a missing explicit source." >&2
  exit 1
fi
grep -Fq 'momo-db migrations directory was not found' "${fixture_root}/output"

printf 'invalid\n' > "${app}/.momo-db-ref"
reject_default invalid-pin
printf '%040d\n' 0 > "${app}/.momo-db-ref"
reject_default unavailable-pin

echo "Migration source selection tests passed."
