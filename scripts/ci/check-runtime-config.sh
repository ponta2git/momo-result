#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

safe_token="0123456789abcdef0123456789abcdef=="
rendered_nginx="${tmp_dir}/nginx.conf"

APP_ENV=prod \
MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
MOMO_NGINX_OUTPUT_PATH="${rendered_nginx}" \
python3 "${repo_root}/deploy/render-nginx-conf.py"

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
  python3 "${repo_root}/deploy/render-nginx-conf.py" >/dev/null 2>&1; then
  echo "production nginx rendering must reject short origin-lock tokens." >&2
  exit 1
fi

if APP_ENV=production \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/unknown-env-nginx.conf" \
  python3 "${repo_root}/deploy/render-nginx-conf.py" >/dev/null 2>&1; then
  echo "nginx rendering must reject unsupported APP_ENV values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST="bad..host" \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/invalid-host-nginx.conf" \
  python3 "${repo_root}/deploy/render-nginx-conf.py" >/dev/null 2>&1; then
  echo "nginx rendering must reject invalid allowed host values." >&2
  exit 1
fi

if APP_ENV=prod \
  MOMO_CANONICAL_HOST=" " \
  MOMO_EXTRA_ALLOWED_HOSTS=" " \
  MOMO_ORIGIN_LOCK_TOKEN="${safe_token}" \
  MOMO_NGINX_TEMPLATE_PATH="${repo_root}/deploy/nginx.conf" \
  MOMO_NGINX_OUTPUT_PATH="${tmp_dir}/empty-host-nginx.conf" \
  python3 "${repo_root}/deploy/render-nginx-conf.py" >/dev/null 2>&1; then
  echo "nginx rendering must reject an empty allowed host set." >&2
  exit 1
fi

python3 -m py_compile "${repo_root}/deploy/render-nginx-conf.py"
python3 -m py_compile \
  "${repo_root}/deploy/postdeploy-smoke.py" \
  "${repo_root}/deploy/release-preflight.py" \
  "${repo_root}/scripts/ci/summarize-runtime-logs.py"

fly_kill_timeout="$(sed -n 's/^kill_timeout = \([0-9][0-9]*\)$/\1/p' "${repo_root}/fly.toml")"
ocr_timeout="$(sed -n 's/^  OCR_TIMEOUT_SECONDS = "\([0-9][0-9]*\)"$/\1/p' "${repo_root}/fly.toml")"
redis_block_timeout="$(sed -n 's/^  OCR_REDIS_BLOCK_SECONDS = "\([0-9][0-9]*\)"$/\1/p' "${repo_root}/fly.toml")"
worker_stop_timeout="$(awk '
  /^\[program:ocr-worker\]$/ { in_worker = 1; next }
  /^\[/ { in_worker = 0 }
  in_worker && /^stopwaitsecs=/ { sub(/^stopwaitsecs=/, ""); print }
' "${repo_root}/deploy/supervisord.conf")"

for value in "${fly_kill_timeout}" "${ocr_timeout}" "${redis_block_timeout}" "${worker_stop_timeout}"; do
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || {
    echo "Runtime shutdown timeouts must be explicit positive integers." >&2
    exit 1
  }
done

if (( worker_stop_timeout < ocr_timeout + 15 )); then
  echo "OCR supervisor stop timeout lacks an in-flight job drain margin." >&2
  exit 1
fi
if (( worker_stop_timeout < redis_block_timeout + 15 )); then
  echo "OCR supervisor stop timeout lacks an idle Redis read drain margin." >&2
  exit 1
fi
if (( fly_kill_timeout < worker_stop_timeout + 10 )); then
  echo "Fly kill timeout lacks a supervisor shutdown margin." >&2
  exit 1
fi

grep -Fqx '[deploy]' "${repo_root}/fly.toml"
grep -Fqx '  release_command = "/opt/momo-result/bin/release-preflight"' \
  "${repo_root}/fly.toml"
grep -Fq 'deploy/release-preflight.py /opt/momo-result/bin/release-preflight' \
  "${repo_root}/Dockerfile"
grep -Fq 'deploy/postdeploy-smoke.py /opt/momo-result/bin/postdeploy-smoke' \
  "${repo_root}/Dockerfile"
