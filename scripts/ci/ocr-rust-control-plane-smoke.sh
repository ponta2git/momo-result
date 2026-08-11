#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

: "${OCR_CONTROL_SMOKE_DATABASE_URL:?an isolated OCR_CONTROL_SMOKE_DATABASE_URL is required}"
: "${OCR_CONTROL_SMOKE_REDIS_URL:?an isolated OCR_CONTROL_SMOKE_REDIS_URL is required}"

cargo test \
  --manifest-path "${repo_root}/apps/analysis-worker/Cargo.toml" \
  --locked \
  ocr::control::integration_tests::real_postgres_and_redis_preserve_ocr_fencing_and_delivery_order \
  -- \
  --ignored \
  --exact
