#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
database_url="${DATABASE_URL:?DATABASE_URL is required.}"
dev_member_ids="${DEV_MEMBER_IDS:?DEV_MEMBER_IDS is required.}"
redis_url="${REDIS_URL:?REDIS_URL is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"

canonical_host="${MOMO_CANONICAL_HOST:-momo-result.ponta.me}"
container_name="${RUNTIME_CONTAINER_NAME:-momo-result-runtime}"
health_url="${RUNTIME_HEALTH_URL:-http://127.0.0.1:8080/healthz}"

docker run -d \
  --name "${container_name}" \
  --network host \
  -e APP_ENV=dev \
  -e DATABASE_URL="${database_url}" \
  -e DEV_MEMBER_IDS="${dev_member_ids}" \
  -e HTTP_HOST=127.0.0.1 \
  -e HTTP_PORT=8081 \
  -e IMAGE_TMP_DIR=/tmp/momo-result/uploads \
  -e MOMO_CANONICAL_HOST="${canonical_host}" \
  -e MOMO_LOG_FORMAT=json \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  -e REDIS_URL="${redis_url}" \
  "${image_ref}"

for _attempt in {1..60}; do
  if curl -fsS "${health_url}" >/dev/null; then
    exit 0
  fi
  sleep 2
done

docker logs "${container_name}"
exit 1
