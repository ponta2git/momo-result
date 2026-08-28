#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="${repo_root}/scripts/ci/public-repo-safety-check.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

case_dir=""

start_case() {
  local name="$1"
  case_dir="${test_root}/${name}"
  mkdir -p "${case_dir}"
  git -C "${case_dir}" init --quiet
}

run_checker() {
  (
    cd "${case_dir}"
    "${checker}"
  )
}

expect_rejected_path() {
  local expected_path="$1"
  local output
  if output="$(run_checker 2>&1)"; then
    echo "Public repository safety accepted forbidden content: ${expected_path}" >&2
    exit 1
  fi
  if ! grep -Fq -- "${expected_path}" <<<"${output}"; then
    echo "Public repository safety did not identify the rejected path: ${expected_path}" >&2
    exit 1
  fi
}

start_case safe-public-files
mkdir -p "${case_dir}/docs/ops"
printf '%s\n' 'EXAMPLE_TOKEN=replace-me' > "${case_dir}/.env.example"
printf '%s\n' '# Public operations principles' > "${case_dir}/docs/ops/README.md"
git -C "${case_dir}" add .env.example docs/ops/README.md
run_checker

start_case forbidden-env
printf '%s\n' 'PLACEHOLDER=value' > "${case_dir}/.env"
git -C "${case_dir}" add -f .env
expect_rejected_path '.env'

start_case forbidden-private-path
mkdir -p "${case_dir}/private"
printf '%s\n' 'local runbook' > "${case_dir}/private/runbook.md"
git -C "${case_dir}" add -f private/runbook.md
expect_rejected_path 'private/runbook.md'

start_case forbidden-ops-detail
mkdir -p "${case_dir}/docs/ops"
printf '%s\n' 'internal detail' > "${case_dir}/docs/ops/internal.md"
git -C "${case_dir}" add docs/ops/internal.md
expect_rejected_path 'docs/ops/internal.md'

start_case secret-redaction
mkdir -p "${case_dir}/src"
printf -v dummy_secret 'AKIA%s' 'QWERTYUIOPASDFGH'
printf '%s\n' "${dummy_secret}" > "${case_dir}/src/value.txt"
secret_output=""
if secret_output="$(run_checker 2>&1)"; then
  echo "Public repository safety accepted a high-risk token pattern." >&2
  exit 1
fi
if ! grep -Fq -- 'src/value.txt' <<<"${secret_output}"; then
  echo "Public repository safety did not identify the secret-bearing path." >&2
  exit 1
fi
if grep -Fq -- "${dummy_secret}" <<<"${secret_output}"; then
  echo "Public repository safety exposed the detected value." >&2
  exit 1
fi
expected_secret_output=$'High-risk public repository content was found:\nsrc/value.txt'
if [[ "${secret_output}" != "${expected_secret_output}" ]]; then
  echo "Public repository safety must report only the secret-bearing path." >&2
  exit 1
fi

echo "Public repository safety tests passed."
