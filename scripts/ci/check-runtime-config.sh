#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

safe_token="0123456789abcdef0123456789abcdef=="
rendered_caddy="${tmp_dir}/Caddyfile"
runtime_tool="${tmp_dir}/momo-runtime-tool"

(
  cd "${repo_root}/tools"
  CGO_ENABLED=0 go build -trimpath -o "${runtime_tool}" ./cmd/momo-runtime-tool
)

APP_ENV=prod \
MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
MOMO_CADDY_TEMPLATE_PATH="${repo_root}/deploy/Caddyfile" \
MOMO_CADDY_OUTPUT_PATH="${rendered_caddy}" \
"${runtime_tool}" render-caddy >/dev/null

if ! grep -Fq "protocols h1 h2c" "${rendered_caddy}"; then
  echo "Caddy must accept HTTP/1.1 and h2c on the public listener." >&2
  exit 1
fi

if ! grep -Fq "reverse_proxy h2c://127.0.0.1:8081" "${rendered_caddy}" ||
  ! grep -Fq "versions h2c" "${rendered_caddy}"; then
  echo "Caddy must use h2c for API upstream requests." >&2
  exit 1
fi

if ! grep -Fq "request>uri delete" "${rendered_caddy}" ||
  ! grep -Fq "request>headers delete" "${rendered_caddy}" ||
  ! grep -Fq "resp_headers delete" "${rendered_caddy}"; then
  echo "Caddy logs must remove request targets, request headers, and response headers." >&2
  exit 1
fi

if grep -Fq "log_credentials" "${rendered_caddy}" ||
  grep -Fq "log_append uri" "${rendered_caddy}"; then
  echo "Caddy logs must not retain credentials or full request targets." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_ORIGIN_LOCK_TOKEN=short \
  MOMO_CADDY_TEMPLATE_PATH="${repo_root}/deploy/Caddyfile" \
  MOMO_CADDY_OUTPUT_PATH="${tmp_dir}/short-token-Caddyfile" \
  "${runtime_tool}" render-caddy >/dev/null 2>&1; then
  echo "production Caddy rendering must reject short origin-lock tokens." >&2
  exit 1
fi

if APP_ENV=production \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_CADDY_TEMPLATE_PATH="${repo_root}/deploy/Caddyfile" \
  MOMO_CADDY_OUTPUT_PATH="${tmp_dir}/unknown-env-Caddyfile" \
  "${runtime_tool}" render-caddy >/dev/null 2>&1; then
  echo "Caddy rendering must reject unsupported APP_ENV values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST="bad..host" \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_CADDY_TEMPLATE_PATH="${repo_root}/deploy/Caddyfile" \
  MOMO_CADDY_OUTPUT_PATH="${tmp_dir}/invalid-host-Caddyfile" \
  "${runtime_tool}" render-caddy >/dev/null 2>&1; then
  echo "Caddy rendering must reject invalid allowed host values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST=" " \
  MOMO_EXTRA_ALLOWED_HOSTS=" " \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_CADDY_TEMPLATE_PATH="${repo_root}/deploy/Caddyfile" \
  MOMO_CADDY_OUTPUT_PATH="${tmp_dir}/empty-host-Caddyfile" \
  "${runtime_tool}" render-caddy >/dev/null 2>&1; then
  echo "Caddy rendering must reject an empty allowed host set." >&2
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
grep -Fqx '  [http_service.http_options]' "${repo_root}/fly.toml"
grep -Fqx '    h2_backend = true' "${repo_root}/fly.toml"
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

for caddy_build_pin in \
  'ARG CADDY_VERSION=v2.11.4' \
  'ARG CADDY_X_NET_VERSION=v0.56.0' \
  'ARG CADDY_X_TEXT_VERSION=v0.39.0' \
  'ARG CADDY_GRPC_VERSION=v1.82.1'; do
  grep -Fqx "${caddy_build_pin}" "${repo_root}/Dockerfile"
done
grep -Fqx 'FROM ${GO_IMAGE} AS caddy-builder' "${repo_root}/Dockerfile"
grep -Fq 'ARG DEBIAN_RUNTIME_IMAGE=debian:bookworm-slim@sha256:' \
  "${repo_root}/Dockerfile"

if grep -Eiq 'nginx' "${repo_root}/Dockerfile"; then
  echo "The main runtime Dockerfile must not retain nginx after the Caddy migration." >&2
  exit 1
fi

if grep -Eiq 'python|supervisor|tesseract|momo-ocr|apps/ocr-worker' "${repo_root}/Dockerfile"; then
  echo "The main runtime Dockerfile must be Python, supervisor, and OCR-worker free." >&2
  exit 1
fi

if [[ -e "${repo_root}/deploy/start-runtime.sh" || -e "${repo_root}/deploy/supervisord.conf" ]]; then
  echo "Legacy shell/supervisord entrypoints must be absent." >&2
  exit 1
fi
