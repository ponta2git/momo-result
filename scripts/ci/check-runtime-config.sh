#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

safe_token="0123456789abcdef0123456789abcdef=="
rendered_nginx="${tmp_dir}/nginx.conf"
runtime_tool="${tmp_dir}/momo-runtime-tool"

(
  cd "${repo_root}/tools"
  CGO_ENABLED=0 go build -trimpath -o "${runtime_tool}" ./cmd/momo-runtime-tool
)

APP_ENV=prod \
MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
MOMO_NGINX_OUTPUT_PATH="${rendered_nginx}" \
"${runtime_tool}" render-nginx >/dev/null

if ! grep -Fq "log_format momo_json escape=json" "${rendered_nginx}"; then
  echo "nginx access logs must use the momo_json log format." >&2
  exit 1
fi

if grep -Fq 'access_log /dev/stdout combined' "${rendered_nginx}"; then
  echo "nginx access logs must not use the combined format." >&2
  exit 1
fi

if awk '!/^[[:space:]]*#/' "${rendered_nginx}" | grep -Eq '\$request([^_[:alnum:]]|$)'; then
  echo 'nginx log format must not include $request because it contains query strings.' >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_ORIGIN_LOCK_TOKEN=short \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/short-token-nginx.conf" \
  "${runtime_tool}" render-nginx >/dev/null 2>&1; then
  echo "production nginx rendering must reject short origin-lock tokens." >&2
  exit 1
fi

if APP_ENV=production \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/unknown-env-nginx.conf" \
  "${runtime_tool}" render-nginx >/dev/null 2>&1; then
  echo "nginx rendering must reject unsupported APP_ENV values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST="bad..host" \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/invalid-host-nginx.conf" \
  "${runtime_tool}" render-nginx >/dev/null 2>&1; then
  echo "nginx rendering must reject invalid allowed host values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST=" " \
  MOMO_EXTRA_ALLOWED_HOSTS=" " \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/empty-host-nginx.conf" \
  "${runtime_tool}" render-nginx >/dev/null 2>&1; then
  echo "nginx rendering must reject an empty allowed host set." >&2
  exit 1
fi

fly_kill_timeout="$(sed -n 's/^kill_timeout = \([0-9][0-9]*\)$/\1/p' "${repo_root}/fly.toml")"
runtime_stop_timeout="$(sed -n 's/^ENV MOMO_RUNTIME_STOP_GRACE_SECONDS=\([0-9][0-9]*\)$/\1/p' "${repo_root}/Dockerfile")"

for value in "${fly_kill_timeout}" "${runtime_stop_timeout}"; do
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || {
    echo "Runtime shutdown timeouts must be explicit positive integers." >&2
    exit 1
  }
done

if (( fly_kill_timeout < runtime_stop_timeout + 10 )); then
  echo "Fly kill timeout lacks a Go supervisor shutdown margin." >&2
  exit 1
fi

grep -Fqx '[deploy]' "${repo_root}/fly.toml"
grep -Fqx '  release_command = "/opt/momo-result/bin/momo-runtime-tool preflight"' \
  "${repo_root}/fly.toml"
grep -Fq '/out/momo-runtime-tool /opt/momo-result/bin/momo-runtime-tool' \
  "${repo_root}/Dockerfile"
grep -Fq 'contracts/runtime-db-contract.json /opt/momo-result/contracts/runtime-db-contract.json' \
  "${repo_root}/Dockerfile"
grep -Fq 'CMD ["/opt/momo-result/bin/momo-runtime-tool", "serve"]' \
  "${repo_root}/Dockerfile"

for jvm_option in \
  '-Xms32m' \
  '-Xmx256m' \
  '-XX:MaxMetaspaceSize=160m' \
  '-XX:CompressedClassSpaceSize=32m' \
  '-XX:ReservedCodeCacheSize=48m' \
  '-Xss512k' \
  '-XX:+UseSerialGC' \
  '-XX:ActiveProcessorCount=2' \
  '-XX:TieredStopAtLevel=1' \
  '-XX:+ExitOnOutOfMemoryError' \
  '-XX:NativeMemoryTracking=summary' \
  '-XX:+PrintNMTStatistics'; do
  grep -Fq -- "${jvm_option}" "${repo_root}/Dockerfile"
done

grep -Fqx 'worker_processes 2;' "${repo_root}/deploy/nginx.conf"
grep -Fq 'ARG DEBIAN_RUNTIME_IMAGE=debian:bookworm-slim@sha256:' \
  "${repo_root}/Dockerfile"

if grep -Eiq 'python|supervisor|tesseract|momo-ocr|apps/ocr-worker' "${repo_root}/Dockerfile"; then
  echo "The main runtime Dockerfile must be Python, supervisor, and OCR-worker free." >&2
  exit 1
fi

if [[ -e "${repo_root}/deploy/start-runtime.sh" || -e "${repo_root}/deploy/supervisord.conf" ]]; then
  echo "Legacy shell/supervisord entrypoints must be absent." >&2
  exit 1
fi
