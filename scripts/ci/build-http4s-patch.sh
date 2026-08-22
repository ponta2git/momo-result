#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ref_file="${HTTP4S_REF_FILE:-${repo_root}/.http4s-ref}"
repository="${HTTP4S_REPOSITORY:-https://github.com/ponta2git/http4s.git}"
output_dir="${HTTP4S_PATCH_OUTPUT_DIR:-${repo_root}/_deps/http4s-patch}"
sbt_command="${SBT_COMMAND:-sbt}"
scala_version="${HTTP4S_SCALA_VERSION:-3.3.6}"
run_tests="${HTTP4S_RUN_TESTS:-0}"

[[ -f "${ref_file}" && ! -L "${ref_file}" ]] || {
  echo "Missing http4s ref file: ${ref_file}" >&2
  exit 1
}
ref="$(tr -d '[:space:]' < "${ref_file}")"
[[ "${ref}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "http4s ref must be a 40-character lowercase commit SHA." >&2
  exit 1
}
[[ -n "${repository}" && "${repository}" != *[[:space:]]* ]] || {
  echo "HTTP4S_REPOSITORY must be a non-empty URL or local Git path without whitespace." >&2
  exit 1
}
[[ "${scala_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "HTTP4S_SCALA_VERSION must be a semantic Scala version." >&2
  exit 1
}
[[ "${run_tests}" == "0" || "${run_tests}" == "1" ]] || {
  echo "HTTP4S_RUN_TESTS must be 0 or 1." >&2
  exit 1
}

read -r -a sbt_args <<< "${sbt_command}"
[[ "${#sbt_args[@]}" -gt 0 ]] || {
  echo "SBT_COMMAND must not be empty." >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "${tmp_dir}"' EXIT
source_dir="${tmp_dir}/http4s"

GIT_TERMINAL_PROMPT=0 git init --quiet "${source_dir}"
GIT_TERMINAL_PROMPT=0 git -C "${source_dir}" remote add origin "${repository}"
GIT_TERMINAL_PROMPT=0 git -C "${source_dir}" fetch --quiet --tags origin
GIT_TERMINAL_PROMPT=0 git -C "${source_dir}" fetch --quiet origin "${ref}"
git -C "${source_dir}" checkout --quiet --detach "${ref}"
actual_ref="$(git -C "${source_dir}" rev-parse HEAD)"
[[ "${actual_ref}" == "${ref}" ]] || {
  echo "Fetched http4s commit does not match the requested ref." >&2
  exit 1
}

version_log="${tmp_dir}/version.log"
if ! (cd "${source_dir}" && "${sbt_args[@]}" -batch 'show version' > "${version_log}" 2>&1); then
  cat "${version_log}" >&2
  exit 1
fi
version="$(sed 's/^\[info\] //' "${version_log}" |
  awk '$0 == "version" { getline; gsub(/^[[:space:]]+/, ""); print; exit }')"
[[ "${version}" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]] || {
  echo "Could not determine a valid http4s version." >&2
  exit 1
}

(
  cd "${source_dir}"
  if [[ "${run_tests}" == "1" ]]; then
    "${sbt_args[@]}" -batch "++${scala_version}" ember-core/test
  fi
  "${sbt_args[@]}" -batch \
    "++${scala_version}" \
    core/publishLocal \
    server/publishLocal \
    ember-core/publishLocal \
    ember-server/publishLocal
)

mkdir -p "${output_dir}"
printf '%s\n' "${repository}" > "${output_dir}/repository.txt"
printf '%s\n' "${actual_ref}" > "${output_dir}/source-sha.txt"
printf '%s\n' "${version}" > "${output_dir}/version.txt"
printf '%s\n' "${scala_version}" > "${output_dir}/scala-version.txt"
printf '%s\n' 'core server ember-core ember-server' > "${output_dir}/modules.txt"
