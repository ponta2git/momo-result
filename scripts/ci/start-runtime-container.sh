#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
database_url="${DATABASE_URL:?DATABASE_URL is required.}"
dev_member_ids="${DEV_MEMBER_IDS:?DEV_MEMBER_IDS is required.}"
redis_url="${REDIS_URL:?REDIS_URL is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"
ocr_redis_block_seconds="${OCR_REDIS_BLOCK_SECONDS:-1}"

canonical_host="${MOMO_CANONICAL_HOST:-momo-result.ponta.me}"
container_name="${RUNTIME_CONTAINER_NAME:-momo-result-runtime}"

runtime_env_args=()
if [[ -n "${IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES:-}" ]]; then
  runtime_env_args+=(-e "IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES=${IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES}")
fi
if [[ -n "${IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT:-}" ]]; then
  runtime_env_args+=(-e "IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT=${IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT}")
fi

docker run -d \
  --name "${container_name}" \
  --network host \
  -e APP_ENV=dev \
  -e DATABASE_URL="${database_url}" \
  -e DEV_MEMBER_IDS="${dev_member_ids}" \
  -e MOMO_CANONICAL_HOST="${canonical_host}" \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  -e OCR_REDIS_BLOCK_SECONDS="${ocr_redis_block_seconds}" \
  -e REDIS_URL="${redis_url}" \
  "${runtime_env_args[@]}" \
  "${image_ref}"

for _attempt in {1..60}; do
  if docker exec "${container_name}" /opt/momo-result/bin/postdeploy-smoke >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done

docker logs "${container_name}" 2>&1 | "${repo_root}/scripts/ci/summarize-runtime-logs.py" >&2
exit 1
