#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"

# The API is the only long-lived process. CMD stays overridable for Fly's
# release_command and the one-off diagnostics below.
if ! docker image inspect "${image_ref}" --format '{{json .Config}}' | jq -e '
  (.Entrypoint == null or .Entrypoint == []) and
  .Cmd == ["/opt/java/openjdk/bin/java", "-cp", "/opt/momo-result/api/lib/*", "momo.api.Main"] and
  .WorkingDir == "/opt/momo-result/api" and .User == "momo"
' > /dev/null; then
  echo "Runtime image must start the API directly with an overridable CMD." >&2
  exit 1
fi

if ! docker run --rm "${image_ref}" /bin/sh -ec '
    test -d /opt/momo-result/api/lib
    test -x /opt/java/openjdk/bin/java
    test -x /opt/momo-result/bin/momo-runtime-tool
    for command_name in caddy go node pnpm python python3 pip pip3 uv momo-ocr supervisord; do
      if command -v "${command_name}" >/dev/null 2>&1; then
        exit 1
      fi
    done
    test ! -e /srv/momo-result/web
    test ! -e /etc/caddy
    test ! -e /opt/momo-result/ocr-worker
    test ! -e /etc/supervisor
    test -w /tmp/momo-result/uploads
  '; then
  echo "API runtime image layout validation failed." >&2
  exit 1
fi

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
