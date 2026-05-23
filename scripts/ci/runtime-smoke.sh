#!/usr/bin/env bash
set -euo pipefail

base_url="${APP_BASE_URL:-http://127.0.0.1:8080}"
dev_account="${DEV_ACCOUNT_ID:-account_ponta}"
canonical_host="${MOMO_CANONICAL_HOST:-momo-result.ponta.me}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:-dev-origin-lock}"

expect_status() {
  local method="$1"
  local url="$2"
  local expected="$3"
  local status

  status="$(curl -sS -o /dev/null -w "%{http_code}" -X "${method}" \
    -H "Host: ${canonical_host}" \
    -H "X-Momo-Origin-Lock: ${origin_lock_token}" \
    "${url}")"
  if [[ "${status}" != "${expected}" ]]; then
    echo "Expected ${method} ${url} to return ${expected}, got ${status}." >&2
    exit 1
  fi
}

expect_status_with_headers() {
  local method="$1"
  local url="$2"
  local expected="$3"
  shift 3
  local status

  status="$(curl -sS -o /dev/null -w "%{http_code}" -X "${method}" "$@" "${url}")"
  if [[ "${status}" != "${expected}" ]]; then
    echo "Expected ${method} ${url} to return ${expected}, got ${status}." >&2
    exit 1
  fi
}

expect_body_contains() {
  local url="$1"
  local expected="$2"
  local body

  body="$(curl -fsS \
    -H "Host: ${canonical_host}" \
    -H "X-Momo-Origin-Lock: ${origin_lock_token}" \
    -H "X-Momo-Account-Id: ${dev_account}" \
    "${url}")"
  if [[ "${body}" != *"${expected}"* ]]; then
    echo "Expected ${url} response to contain ${expected}." >&2
    echo "${body}" >&2
    exit 1
  fi
}

expect_body_contains "${base_url}/healthz" '"status":"ok"'
expect_body_contains "${base_url}/healthz/details" '"database":"ok"'
expect_body_contains "${base_url}/healthz/details" '"redis":"ok"'
expect_body_contains "${base_url}/api/auth/me" "\"accountId\":\"${dev_account}\""

expect_status GET "${base_url}/" 200
expect_status GET "${base_url}/matches/e2e-deep-link" 200
expect_status POST "${base_url}/assets/missing.js" 405
expect_status GET "${base_url}/openapi.yaml" 404

expect_status_with_headers GET "${base_url}/" 421 \
  -H "Host: ${canonical_host}"
expect_status_with_headers GET "${base_url}/" 421 \
  -H "Host: momo-result.fly.dev" \
  -H "X-Momo-Origin-Lock: ${origin_lock_token}"
expect_status_with_headers GET "${base_url}/" 421 \
  -H "Host: unknown.example" \
  -H "X-Momo-Origin-Lock: ${origin_lock_token}"
expect_status_with_headers GET "${base_url}/healthz" 200 \
  -H "Host: ${canonical_host}"
