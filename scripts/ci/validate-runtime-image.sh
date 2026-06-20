#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"

docker run --rm \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  "${image_ref}" \
  /bin/sh -c 'nginx_conf="${MOMO_NGINX_OUTPUT_PATH:-/etc/nginx/nginx.conf}"; /opt/momo-result/bin/render-nginx-conf && nginx -t -c "${nginx_conf}"'

docker run --rm "${image_ref}" test -x /opt/momo-result/api/bin/momo-result-api
docker run --rm "${image_ref}" momo-ocr --help
docker run --rm "${image_ref}" python -c 'from momo_ocr.features.ocr_jobs.queue_contract import parse_job_message; parse_job_message({"schemaVersion":"1","jobId":"job-smoke","draftId":"draft-smoke","imageId":"image-smoke","imagePath":"/tmp/momo-result/uploads/image-smoke.png","requestedScreenType":"total_assets","attempt":"1","enqueuedAt":"2026-05-24T00:00:00Z"})'
