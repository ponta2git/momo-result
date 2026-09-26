#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"
origin_lock_token="${MOMO_ORIGIN_LOCK_TOKEN:?MOMO_ORIGIN_LOCK_TOKEN is required.}"

if ! docker run --rm \
  -e MOMO_ORIGIN_LOCK_TOKEN="${origin_lock_token}" \
  "${image_ref}" \
  /bin/sh -ec '
    test -d /opt/momo-result/api/lib
    test -x /opt/java/openjdk/bin/java
    test -x /usr/bin/caddy
    test -x /opt/momo-result/bin/momo-runtime-tool
    for command_name in python python3 pip pip3 uv momo-ocr supervisord; do
      if command -v "${command_name}" >/dev/null 2>&1; then
        exit 1
      fi
    done
    test ! -e /opt/momo-result/ocr-worker
    test ! -e /etc/supervisor
    caddy_config="${MOMO_CADDY_OUTPUT_PATH:-/tmp/momo-result/caddy/Caddyfile}"
    /opt/momo-result/bin/momo-runtime-tool render-caddy >/dev/null
    caddy validate --config "${caddy_config}" --adapter caddyfile >/dev/null
    caddy adapt --config "${caddy_config}" --adapter caddyfile
  ' | jq -e '
    [.logging.logs[]] as $logs |
    (($logs | length) >= 2) and
    all($logs[];
      .encoder.format == "filter" and
      .encoder.wrap.format == "json" and
      .encoder.fields["request>uri"].filter == "delete" and
      .encoder.fields["request>headers"].filter == "delete" and
      .encoder.fields.resp_headers.filter == "delete"
    )
  ' > /dev/null; then
  echo "Runtime image layout or Caddy log redaction validation failed." >&2
  exit 1
fi

caddy_version="$(
  docker run --rm --entrypoint /usr/bin/caddy "${image_ref}" version
)"
if [[ "${caddy_version}" != "v2.11.4" ]]; then
  echo "Runtime image does not contain the required Caddy version." >&2
  exit 1
fi

caddy_build_info="$(
  docker run --rm --entrypoint /usr/bin/caddy "${image_ref}" build-info
)"
for required_build_dependency in \
  $'go\tgo1.27.1' \
  $'dep\tgolang.org/x/crypto\tv0.55.0\t' \
  $'dep\tgolang.org/x/net\tv0.58.0\t' \
  $'dep\tgolang.org/x/text\tv0.41.0\t' \
  $'dep\tgoogle.golang.org/grpc\tv1.83.2\t'; do
  if ! grep -Fq -- "${required_build_dependency}" <<<"${caddy_build_info}"; then
    echo "Runtime Caddy build is missing a required patched dependency." >&2
    exit 1
  fi
done

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime-jvm-profile.sh" "${image_ref}"
invalid_host_status=0
invalid_host_report="$(docker run --rm "${image_ref}" \
  /opt/momo-result/bin/momo-runtime-tool smoke edge invalid_host 2>&1)" || invalid_host_status=$?
if [[ "${invalid_host_status}" != "1" ]] || ! jq -es '
  length == 1 and (.[0] |
    .event == "runtime_public_edge_smoke" and .status == "failed" and .errorClass == "InvalidConfiguration")
' <<<"${invalid_host_report}" >/dev/null 2>&1; then
  echo "Runtime tool must reject an invalid public-edge host." >&2
  exit 1
fi
