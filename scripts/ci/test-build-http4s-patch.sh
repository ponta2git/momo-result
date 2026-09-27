#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
builder="${repo_root}/scripts/ci/build-http4s-patch.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "${test_root}"' EXIT

source_repo="${test_root}/source"
git init --quiet --initial-branch=main "${source_repo}"
git -C "${source_repo}" config user.email fixture@example.invalid
git -C "${source_repo}" config user.name Fixture
printf '%s\n' upstream > "${source_repo}/source.txt"
git -C "${source_repo}" add .
git -C "${source_repo}" commit --quiet -m upstream
git -C "${source_repo}" tag -a v0.23.36 -m release
printf '%s\n' patch >> "${source_repo}/source.txt"
git -C "${source_repo}" commit --quiet -am patch
patch_sha="$(git -C "${source_repo}" rev-parse HEAD)"
printf '%s\n' "${patch_sha}" > "${test_root}/ref"
description="$(git -C "${source_repo}" describe --tags --long --abbrev=40)"

# An unrelated, untagged branch must not be needed to build the pinned patch.
git -C "${source_repo}" checkout --quiet -b unrelated
printf '%s\n' unrelated > "${source_repo}/unrelated.txt"
git -C "${source_repo}" add .
git -C "${source_repo}" commit --quiet -m unrelated
unrelated_sha="$(git -C "${source_repo}" rev-parse HEAD)"

cat > "${test_root}/sbt" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Inspect the real checkout at the build-tool boundary. This catches missing
# tags/history and fetching a moving branch in place of the pinned commit.
[[ "$(git rev-parse HEAD)" == "${HTTP4S_TEST_SHA}" ]]
[[ "$(git describe --tags --long --abbrev=40)" == "${HTTP4S_TEST_DESCRIPTION}" ]]
[[ "$(git rev-parse --is-shallow-repository)" == false ]]
if git cat-file -e "${HTTP4S_TEST_UNRELATED_SHA}^{commit}" 2>/dev/null; then
  echo "Builder fetched an unrelated branch tip." >&2
  exit 1
fi
printf '%s\n' invocation >> "${HTTP4S_TEST_LOG_DIR}/invocations"
[[ "$1" == -batch ]]
shift
if [[ "$*" == 'show ThisBuild / version' ]]; then
  printf '[info] ember-core / version\n[info] \033[32m%s\033[0m\r\n[info] ThisBuild / version\n' \
    "${HTTP4S_TEST_DESCRIPTION#v}"
  exit 0
fi

for task in "$@"; do
  printf '%s\n' "${task}" >> "${HTTP4S_TEST_LOG_DIR}/tasks"
  if [[ "${task}" == ember-core/test && "${HTTP4S_TEST_FAIL:-0}" == 1 ]]; then
    exit 1
  fi
done
EOF
chmod +x "${test_root}/sbt"

run_builder() {
  local case_name="$1"
  local run_tests="$2"
  mkdir -p "${test_root}/${case_name}"
  HTTP4S_REPOSITORY="${source_repo}" \
    HTTP4S_REF_FILE="${test_root}/ref" \
    HTTP4S_PATCH_OUTPUT_DIR="${test_root}/${case_name}/output" \
    HTTP4S_SCALA_VERSION=3.3.6 HTTP4S_RUN_TESTS="${run_tests}" \
    SBT_COMMAND="${test_root}/sbt" \
    HTTP4S_TEST_SHA="${patch_sha}" \
    HTTP4S_TEST_DESCRIPTION="${description}" \
    HTTP4S_TEST_UNRELATED_SHA="${unrelated_sha}" \
    HTTP4S_TEST_LOG_DIR="${test_root}/${case_name}" \
    "${builder}"
}

run_builder with-tests 1
output_dir="${test_root}/with-tests/output"
[[ "$(< "${output_dir}/source-sha.txt")" == "${patch_sha}" ]]
[[ "$(< "${output_dir}/version.txt")" == "${description#v}" ]]
[[ "$(< "${output_dir}/repository.txt")" == "${source_repo}" ]]
[[ "$(< "${output_dir}/scala-version.txt")" == 3.3.6 ]]
[[ "$(< "${output_dir}/modules.txt")" == 'core server ember-core ember-server' ]]
[[ "$(wc -l < "${test_root}/with-tests/invocations" | tr -d '[:space:]')" == 2 ]]
printf '%s\n' ++3.3.6 ember-core/test \
  core/publishLocal server/publishLocal ember-core/publishLocal ember-server/publishLocal \
  > "${test_root}/expected-tasks"
diff -u "${test_root}/expected-tasks" "${test_root}/with-tests/tasks"

run_builder without-tests 0
sed '/^ember-core\/test$/d' "${test_root}/expected-tasks" > "${test_root}/without-test-tasks"
diff -u "${test_root}/without-test-tasks" "${test_root}/without-tests/tasks"

if HTTP4S_TEST_FAIL=1 run_builder failed-test 1 >/dev/null 2>&1; then
  echo "Builder accepted a failed patch test." >&2
  exit 1
fi
[[ ! -e "${test_root}/failed-test/output/version.txt" ]]
if grep -q publishLocal "${test_root}/failed-test/tasks"; then
  echo "Builder published artifacts after a failed patch test." >&2
  exit 1
fi

echo "http4s patch builder tests passed."
