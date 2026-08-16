#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"

docker run --rm \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  "${image_ref}" \
  /bin/sh -c 'caddy_config="${MOMO_CADDY_OUTPUT_PATH:-/tmp/momo-result/caddy/Caddyfile}"; /opt/momo-result/bin/momo-runtime-tool render-caddy >/dev/null && caddy validate --config "${caddy_config}" --adapter caddyfile'

docker run --rm "${image_ref}" test -d /opt/momo-result/api/lib
docker run --rm "${image_ref}" test -x /opt/java/openjdk/bin/java
docker run --rm "${image_ref}" test -x /usr/bin/caddy
docker run --rm "${image_ref}" test -x /opt/momo-result/bin/momo-runtime-tool
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime-jvm-profile.sh" "${image_ref}"
if docker run --rm "${image_ref}" \
  /opt/momo-result/bin/momo-runtime-tool smoke edge invalid_host >/dev/null 2>&1; then
  echo "Runtime tool must reject an invalid public-edge host." >&2
  exit 1
fi
docker run --rm "${image_ref}" /bin/sh -ec '
  for command_name in python python3 pip pip3 uv momo-ocr supervisord; do
    if command -v "${command_name}" >/dev/null 2>&1; then
      exit 1
    fi
  done
  test ! -e /opt/momo-result/ocr-worker
  test ! -e /etc/supervisor
'
