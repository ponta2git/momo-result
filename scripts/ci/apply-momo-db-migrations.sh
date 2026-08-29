#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migrations_dir="${MOMO_DB_MIGRATIONS_DIR:-${repo_root}/_deps/momo-db/drizzle}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
attestation_file="${MOMO_DB_BOOTSTRAP_ATTESTATION_FILE:-}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi
if [[ "${MOMO_DB_BOOTSTRAP_IS_FRESH:-}" != "true" ]]; then
  echo "MOMO_DB_BOOTSTRAP_IS_FRESH=true is required for the fresh-database bootstrap." >&2
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

if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
  : "${POSTGRES_USER:?POSTGRES_USER is required with POSTGRES_CONTAINER}"
  : "${POSTGRES_DB:?POSTGRES_DB is required with POSTGRES_CONTAINER}"
fi

if [[ -n "${attestation_file}" ]]; then
  if [[ "${attestation_file}" != /* || ! -d "$(dirname "${attestation_file}")" ]]; then
    echo "MOMO_DB_BOOTSTRAP_ATTESTATION_FILE must be in an existing absolute directory." >&2
    exit 1
  fi
  if [[ -L "${attestation_file}" || ( -e "${attestation_file}" && ! -f "${attestation_file}" ) ]]; then
    echo "Refusing a non-regular bootstrap attestation file." >&2
    exit 1
  fi
  # Any bootstrap attempt invalidates an older approval token before inspecting or mutating the
  # target. A failed or misdirected attempt must not leave a reusable attestation behind.
  umask 077
  : >"${attestation_file}"
fi

psql_bootstrap() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    docker exec -i "${POSTGRES_CONTAINER}" \
      psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -X -v ON_ERROR_STOP=1 "$@"
  else
    docker run --rm -i --network host \
      --add-host host.docker.internal:host-gateway \
      -e DATABASE_URL="${DATABASE_URL}" \
      "${postgres_image}" \
      psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 "$@"
  fi
}

existing_relations="$(psql_bootstrap -At -c "
  SELECT COUNT(*)::int
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp_%'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');
")"
if [[ "${existing_relations}" != "0" ]]; then
  echo "Refusing to bootstrap a PostgreSQL database that already contains application relations." >&2
  exit 1
fi
for migration in "${migrations[@]}"; do
  echo "Applying momo-db migration $(basename "${migration}")"
done

# This is a fresh disposable-database bootstrap, not a replacement for Drizzle's migration ledger.
# Match only Drizzle's PostgreSQL transaction boundary: a transition file may intentionally hold a
# transaction-scoped advisory or table lock for a later file in this ordered bootstrap.
if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
  {
    for migration in "${migrations[@]}"; do
      printf '\n-- momo-db migration: %s\n' "$(basename "${migration}")"
      command cat "${migration}"
      printf '\n'
    done
  } | docker exec -i "${POSTGRES_CONTAINER}" \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -X -v ON_ERROR_STOP=1 --single-transaction
else
  migration_arguments=()
  for migration in "${migrations[@]}"; do
    migration_arguments+=("-f" "/migrations/$(basename "${migration}")")
  done
  docker run --rm \
    --network host \
    --add-host host.docker.internal:host-gateway \
    -e DATABASE_URL="${DATABASE_URL}" \
    -v "${migrations_dir}:/migrations:ro" \
    "${postgres_image}" \
    psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 --single-transaction \
    "${migration_arguments[@]}"
fi

if [[ -n "${attestation_file}" ]]; then
  bootstrap_identity="$(psql_bootstrap -At -c \
    "SELECT json_build_array(
       control_state.system_identifier::text,
       current_database(),
       database.oid::text
     )::text
     FROM pg_control_system() AS control_state
     JOIN pg_database AS database ON database.datname = current_database();")"
  if [[ -z "${bootstrap_identity}" ]]; then
    echo "Could not attest the bootstrapped PostgreSQL database." >&2
    exit 1
  fi
  printf '%s\n' "${bootstrap_identity}" >"${attestation_file}"
fi
