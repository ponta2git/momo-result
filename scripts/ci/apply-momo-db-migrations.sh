#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migrations_dir="${MOMO_DB_MIGRATIONS_DIR:-${repo_root}/_deps/momo-db/drizzle}"
postgres_image="${POSTGRES_IMAGE:-postgres:18-alpine}"
attestation_file="${MOMO_DB_BOOTSTRAP_ATTESTATION_FILE:-}"
bootstrap_profile="${MOMO_DB_BOOTSTRAP_PROFILE:-migrations}"

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

case "${bootstrap_profile}" in
  migrations) ;;
  web-e2e)
    publication_contract="${repo_root}/docs/schemas/series-analysis-publication-contract-v2.json"
    fixture_contract="$(jq -er '
      select(.contractVersion == 2) |
      select(.artifactSchemaVersion | type == "number" and . == floor and . > 0 and . <= 2147483647) |
      select(.validationContractId | type == "string" and test("\\A[a-z0-9][a-z0-9._-]{0,127}\\z")) |
      [.artifactSchemaVersion, .validationContractId] | @tsv
    ' "${publication_contract}")"
    read -r fixture_schema fixture_validation <<< "${fixture_contract}"
    ;;
  *)
    echo "Unknown fresh-database bootstrap profile." >&2
    exit 1
    ;;
esac

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

web_e2e_fixture() {
  [[ "${bootstrap_profile}" == "web-e2e" ]] || return 0
  # Only an empty, newly migrated fixture may select the current publication contract directly.
  # Existing databases must use the release controller; do not change the migration baseline.
  cat <<SQL
DO \$fixture\$
DECLARE updated_rows integer;
BEGIN
  IF (SELECT count(*) FROM series_analysis_release_state) <> 1
     OR EXISTS (SELECT 1 FROM game_titles)
     OR EXISTS (SELECT 1 FROM series_analysis_operation_requests)
     OR EXISTS (SELECT 1 FROM series_analysis_campaigns)
     OR EXISTS (SELECT 1 FROM series_analysis_reader_capabilities)
     OR EXISTS (SELECT 1 FROM series_analysis_worker_capabilities) THEN
    RAISE EXCEPTION 'Web E2E requires an unused analysis fixture';
  END IF;
  UPDATE series_analysis_release_state
  SET artifact_schema_version = ${fixture_schema},
      validation_contract_id = '${fixture_validation}',
      updated_at = clock_timestamp()
  WHERE singleton_key = 'current';
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 1 THEN
    RAISE EXCEPTION 'Web E2E requires one analysis release singleton';
  END IF;
END
\$fixture\$;
SQL
}

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
    web_e2e_fixture
  } | docker exec -i "${POSTGRES_CONTAINER}" \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -X -v ON_ERROR_STOP=1 --single-transaction -f -
else
  migration_arguments=()
  for migration in "${migrations[@]}"; do
    migration_arguments+=("-f" "/migrations/$(basename "${migration}")")
  done
  web_e2e_fixture | docker run --rm -i \
    --network host \
    --add-host host.docker.internal:host-gateway \
    -e DATABASE_URL="${DATABASE_URL}" \
    -v "${migrations_dir}:/migrations:ro" \
    "${postgres_image}" \
    psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 --single-transaction \
      "${migration_arguments[@]}" -f -
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
