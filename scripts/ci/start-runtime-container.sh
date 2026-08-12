#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
database_url="${DATABASE_URL:?DATABASE_URL is required.}"
dev_member_ids="${DEV_MEMBER_IDS:?DEV_MEMBER_IDS is required.}"
redis_url="${REDIS_URL:?REDIS_URL is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"

canonical_host="${MOMO_CANONICAL_HOST:-momo-result.ponta.me}"
container_name="${RUNTIME_CONTAINER_NAME:-momo-result-runtime}"

runtime_limit_args=()
if [[ -n "${RUNTIME_MEMORY_LIMIT:-}" ]]; then
  runtime_limit_args+=(--memory "${RUNTIME_MEMORY_LIMIT}" --memory-swap "${RUNTIME_MEMORY_LIMIT}")
fi
if [[ -n "${RUNTIME_CPU_LIMIT:-}" ]]; then
  runtime_limit_args+=(--cpus "${RUNTIME_CPU_LIMIT}")
fi

runtime_env_args=(-e APP_ENV=dev)
if [[ -n "${IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES:-}" ]]; then
  runtime_env_args+=(-e "IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES=${IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES}")
fi
if [[ -n "${IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT:-}" ]]; then
  runtime_env_args+=(-e "IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT=${IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT}")
fi

docker run -d \
  --name "${container_name}" \
  --network host \
  "${runtime_limit_args[@]}" \
  -e DATABASE_URL="${database_url}" \
  -e DEV_MEMBER_IDS="${dev_member_ids}" \
  -e MOMO_CANONICAL_HOST="${canonical_host}" \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  -e REDIS_URL="${redis_url}" \
  "${runtime_env_args[@]}" \
  "${image_ref}"

for _attempt in {1..60}; do
  if docker exec "${container_name}" /opt/momo-result/bin/momo-runtime-tool smoke local >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done

docker logs "${container_name}" 2>&1 | \
  IMAGE_REF="${image_ref}" "${repo_root}/scripts/ci/summarize-runtime-logs.sh" >&2
exit 1
