#!/usr/bin/env bash

readonly analysis_smoke_algorithm_version="series-analysis-v3"

analysis_smoke_require_isolated_services() {
  if [[ "${ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED:-}" != "true" ]]; then
    echo "ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED=true is required." >&2
    return 1
  fi
  return 0
}

analysis_smoke_postgres_identity() {
  local postgres_image="$1"
  local database_url="$2"

  # PostgreSQL's system identifier and database name stay stable across connection host aliases.
  docker run --rm --network host \
    --add-host host.docker.internal:host-gateway \
    "${postgres_image}" \
    psql -XAt -v ON_ERROR_STOP=1 -d "${database_url}" -c \
      "SELECT json_build_array(
         control_state.system_identifier::text,
         current_database(),
         database.oid::text
       )::text
       FROM pg_control_system() AS control_state
       JOIN pg_database AS database ON database.datname = current_database();"
}

analysis_smoke_require_bootstrapped_postgres() {
  local postgres_image="$1"
  local database_url="$2"
  local attestation_file="${ANALYSIS_SMOKE_DATABASE_ATTESTATION_FILE:-}"
  local expected_identity
  local actual_identity

  if [[ -z "${attestation_file}" || ! -f "${attestation_file}" || -L "${attestation_file}" ]]; then
    echo "A regular ANALYSIS_SMOKE_DATABASE_ATTESTATION_FILE from the fresh bootstrap is required." >&2
    return 1
  fi
  IFS= read -r expected_identity <"${attestation_file}" || true
  if [[ -z "${expected_identity}" ]]; then
    echo "The PostgreSQL bootstrap attestation is empty." >&2
    return 1
  fi
  if ! actual_identity="$(
    analysis_smoke_postgres_identity "${postgres_image}" "${database_url}"
  )" || [[ -z "${actual_identity}" ]]; then
    echo "Could not verify the freshly bootstrapped PostgreSQL database." >&2
    return 1
  fi
  if [[ "${actual_identity}" != "${expected_identity}" ]]; then
    echo "DATABASE_URL does not match the freshly bootstrapped PostgreSQL database." >&2
    return 1
  fi
  return 0
}

analysis_smoke_require_same_postgres_database() {
  local postgres_image="$1"
  local reference_url="$2"
  shift 2

  if (( $# == 0 || $# % 2 != 0 )); then
    echo "PostgreSQL identity checks require label/URL pairs." >&2
    return 1
  fi

  local reference_identity
  if ! reference_identity="$(
    analysis_smoke_postgres_identity "${postgres_image}" "${reference_url}"
  )" || [[ -z "${reference_identity}" ]]; then
    echo "Could not read the isolated PostgreSQL identity through DATABASE_URL." >&2
    return 1
  fi

  local candidate_identity
  local candidate_label
  local candidate_url
  while (( $# > 0 )); do
    candidate_label="$1"
    candidate_url="$2"
    shift 2
    if ! candidate_identity="$(
      analysis_smoke_postgres_identity "${postgres_image}" "${candidate_url}"
    )" || [[ -z "${candidate_identity}" ]]; then
      echo "Could not read the isolated PostgreSQL identity through ${candidate_label}." >&2
      return 1
    fi
    if [[ "${candidate_identity}" != "${reference_identity}" ]]; then
      echo "${candidate_label} must address the same PostgreSQL cluster and database as DATABASE_URL." >&2
      return 1
    fi
  done
  return 0
}

analysis_smoke_redis_identity() {
  local redis_image="$1"
  local redis_url="$2"
  local server_info
  local client_info
  local run_id
  local database

  server_info="$(
    docker run --rm --network host \
      --add-host host.docker.internal:host-gateway \
      "${redis_image}" \
      redis-cli --raw -u "${redis_url}" INFO server
  )"
  client_info="$(
    docker run --rm --network host \
      --add-host host.docker.internal:host-gateway \
      "${redis_image}" \
      redis-cli --raw -u "${redis_url}" CLIENT INFO
  )"
  run_id="$(awk -F: '$1 == "run_id" { sub(/\r$/, "", $2); print $2; exit }' <<<"${server_info}")"
  database="$(sed -nE 's/.*(^| )db=([0-9]+)( |$).*/\2/p' <<<"${client_info}")"
  if [[ -z "${run_id}" || -z "${database}" ]]; then
    return 1
  fi
  printf '%s|%s\n' "${run_id}" "${database}"
}

analysis_smoke_require_same_redis_database() {
  local redis_image="$1"
  local reference_url="$2"
  shift 2

  if (( $# == 0 || $# % 2 != 0 )); then
    echo "Redis identity checks require label/URL pairs." >&2
    return 1
  fi

  local reference_identity
  if ! reference_identity="$(
    analysis_smoke_redis_identity "${redis_image}" "${reference_url}"
  )" || [[ -z "${reference_identity}" ]]; then
    echo "Could not read the isolated Redis identity through REDIS_URL." >&2
    return 1
  fi

  local candidate_identity
  local candidate_label
  local candidate_url
  while (( $# > 0 )); do
    candidate_label="$1"
    candidate_url="$2"
    shift 2
    if ! candidate_identity="$(
      analysis_smoke_redis_identity "${redis_image}" "${candidate_url}"
    )" || [[ -z "${candidate_identity}" ]]; then
      echo "Could not read the isolated Redis identity through ${candidate_label}." >&2
      return 1
    fi
    if [[ "${candidate_identity}" != "${reference_identity}" ]]; then
      echo "${candidate_label} must address the same Redis instance and database as REDIS_URL." >&2
      return 1
    fi
  done
  return 0
}
