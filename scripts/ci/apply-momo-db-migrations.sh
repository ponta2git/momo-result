#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migrations_dir="${MOMO_DB_MIGRATIONS_DIR:-${repo_root}/_deps/momo-db/drizzle}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [[ "${migrations_dir}" != /* ]]; then
  migrations_dir="${repo_root}/${migrations_dir}"
fi

if [[ ! -d "${migrations_dir}" ]]; then
  echo "momo-db migrations directory was not found: ${migrations_dir}" >&2
  exit 1
fi

shopt -s nullglob
migrations=("${migrations_dir}"/*.sql)
shopt -u nullglob

if [[ "${#migrations[@]}" -eq 0 ]]; then
  echo "No momo-db migration SQL files found in ${migrations_dir}." >&2
  exit 1
fi

for migration in "${migrations[@]}"; do
  name="$(basename "${migration}")"
  echo "Applying momo-db migration ${name}"
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -i "${POSTGRES_CONTAINER}" psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 \
      <"${migration}"
  else
    docker run --rm \
      --network host \
      -e DATABASE_URL="${DATABASE_URL}" \
      -v "${migrations_dir}:/migrations:ro" \
      "${postgres_image}" \
      psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "/migrations/${name}"
  fi
done
