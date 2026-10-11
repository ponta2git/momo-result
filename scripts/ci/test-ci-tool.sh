#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
mkdir -p "${test_dir}/bin" "${test_dir}/unrelated" "${test_dir}/directory"
export TEST_CI_TOOL_STATE="${test_dir}" TEST_CI_TOOL_ROOT="${repo_root}"

# An executable double observes the launcher boundary: checkout root, exact
# argument boundaries, stdin, stdout/stderr, and nonzero exit status.
cat > "${test_dir}/tool" <<'TOOL'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 5 && "$1" == --repo-root && "$2" == "${TEST_CI_TOOL_ROOT}" ]]
[[ "$3" == analysis-report && "$4" == --from-log && "$5" == 'input with spaces.json' ]]
cat > "${TEST_CI_TOOL_STATE}/stdin"
printf '%s\n' 'fixture stdout'
printf '%s\n' 'fixture stderr' >&2
exit 7
TOOL
chmod +x "${test_dir}/tool"
status=0
(
  cd "${test_dir}/unrelated"
  printf '%s\n' 'input stream' |
    MOMO_CI_TOOL="${test_dir}/tool" "${repo_root}/scripts/ci/ci-tool.sh" \
      analysis-report --from-log 'input with spaces.json'
) > "${test_dir}/out" 2> "${test_dir}/err" || status=$?
[[ "${status}" == 7 ]]
[[ "$(< "${test_dir}/stdin")" == 'input stream' ]]
[[ "$(< "${test_dir}/out")" == 'fixture stdout' ]]
[[ "$(< "${test_dir}/err")" == 'fixture stderr' ]]

printf 'not executable\n' > "${test_dir}/plain"
for invalid in '' relative/tool "${test_dir}/directory" "${test_dir}/plain" "${test_dir}/missing"; do
  if MOMO_CI_TOOL="${invalid}" "${repo_root}/scripts/ci/ci-tool.sh" --help \
    > "${test_dir}/out" 2> "${test_dir}/err"; then
    echo 'The launcher accepted an unavailable executable file.' >&2
    exit 1
  fi
  [[ ! -s "${test_dir}/out" ]]
done

# A compiler double avoids recompiling in this Shell contract. It verifies that
# the builder supplies the module cwd and one exact absolute output path.
cat > "${test_dir}/bin/go" <<'GO'
#!/usr/bin/env bash
set -euo pipefail
printf 'called\n' >> "${TEST_CI_TOOL_STATE}/builds"
[[ "${PWD}" == "${TEST_CI_TOOL_ROOT}/scripts/tools" ]]
[[ "$#" == 5 && "$1" == build && "$2" == -trimpath && "$3" == -o && "$5" == ./cmd/ci-tool ]]
[[ "${TEST_BUILD_STATUS:-0}" == 0 ]] || exit "${TEST_BUILD_STATUS}"
[[ "${TEST_NO_OUTPUT:-false}" != true ]] || exit 0
printf '#!/usr/bin/env bash\nexit 0\n' > "$4"
chmod +x "$4"
GO
chmod +x "${test_dir}/bin/go"
ln -s "${test_dir}/tool" "${test_dir}/link"
for invalid in relative/tool "${test_dir}/directory" "${test_dir}/link"; do
  status=0
  PATH="${test_dir}/bin:${PATH}" "${repo_root}/scripts/ci/build-ci-tool.sh" "${invalid}" \
    > "${test_dir}/out" 2> "${test_dir}/err" || status=$?
  [[ "${status}" == 2 && ! -e "${test_dir}/builds" ]]
done
(
  cd "${test_dir}/unrelated"
  PATH="${test_dir}/bin:${PATH}" "${repo_root}/scripts/ci/build-ci-tool.sh" "${test_dir}/nested path/ci-tool"
)
[[ -x "${test_dir}/nested path/ci-tool" ]]
status=0
PATH="${test_dir}/bin:${PATH}" TEST_BUILD_STATUS=17 \
  "${repo_root}/scripts/ci/build-ci-tool.sh" "${test_dir}/failed-tool" \
  > "${test_dir}/out" 2> "${test_dir}/err" || status=$?
[[ "${status}" == 17 && ! -e "${test_dir}/failed-tool" ]]
status=0
PATH="${test_dir}/bin:${PATH}" TEST_NO_OUTPUT=true \
  "${repo_root}/scripts/ci/build-ci-tool.sh" "${test_dir}/missing-output" \
  > "${test_dir}/out" 2> "${test_dir}/err" || status=$?
[[ "${status}" == 1 ]]
echo 'CI tool build and launcher contracts passed.'
