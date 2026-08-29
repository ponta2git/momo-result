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
      "SELECT json_build_array(control_state.system_identifier::text, current_database())::text
       FROM pg_control_system() AS control_state;"
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
