#!/usr/bin/env bash
# One-off maintenance barrier. Remove after the DB-job release is verified.
set -euo pipefail

if [[ "${JOBS_CUTOVER_COMPLETE:-}" == true ]]; then exit 0; fi
: "${JOBS_CUTOVER_DB_RUN_ID:?select the approved momo-db CI run before this release}"
: "${GITHUB_REPOSITORY_OWNER:?required}"
: "${RUNTIME_FLY_API_TOKEN:?required}"
: "${WORKER_FLY_API_TOKEN:?required}"
[[ "${JOBS_CUTOVER_DB_RUN_ID}" =~ ^[1-9][0-9]*$ ]] || exit 2
expected_db_commit="$(tr -d '\r\n' < .momo-db-ref)"
[[ "${expected_db_commit}" =~ ^[0-9a-f]{40}$ ]] || exit 2
repository="${GITHUB_REPOSITORY_OWNER}/momo-db"

read_migration_run() {
  local run
  run="$(gh run view "${JOBS_CUTOVER_DB_RUN_ID}" --repo "${repository}" \
    --json headSha,headBranch,event,workflowName,status,conclusion,jobs)"
  jq -e --arg sha "${expected_db_commit}" \
    '.headSha == $sha and .headBranch == "master" and .event == "push" and .workflowName == "CI"' \
    <<< "${run}" > /dev/null || {
      echo 'The DB run does not match the pinned production migration commit.' >&2; return 1;
    }
  printf '%s\n' "${run}"
}

machine_list() {
  FLY_API_TOKEN="$2" flyctl machine list --app "$1" --json
}
assert_stopped() {
  machine_list "$1" "$2" | jq -e '
    type == "array" and all(.[]; .state == "stopped" and
      .config.restart.policy == "no" and
      ((.config.schedule // "") == "") and
      all(.config.services[]?; .autostart == false))' > /dev/null || {
        echo 'Maintenance barrier lost: a machine is running or can restart.' >&2; return 1;
      }
}
stop_app() {
  local app="$1" token="$2" machines id
  machines="$(machine_list "${app}" "${token}")"
  jq -e 'type == "array" and all(.[]; (.id | test("^[a-zA-Z0-9]+$")) and
    ((.config.schedule // "") == ""))' <<< "${machines}" > /dev/null
  while IFS= read -r id; do
    [[ -n "${id}" ]] || continue
    FLY_API_TOKEN="${token}" flyctl machine update "${id}" --app "${app}" \
      --autostart=false --restart=no --skip-start --yes > /dev/null
    FLY_API_TOKEN="${token}" flyctl machine stop "${id}" --app "${app}" \
      --signal SIGTERM --timeout 90 --wait-timeout 120s > /dev/null
  done < <(jq -r '.[].id' <<< "${machines}")
  assert_stopped "${app}" "${token}"
}

# Validate the exact owner run before touching either application. The protected
# DB approval is released by the operator only after both stop checks below.
read_migration_run > /dev/null
stop_app momo-result "${RUNTIME_FLY_API_TOKEN}"
stop_app momo-result-analysis "${WORKER_FLY_API_TOKEN}"
echo 'Both applications are stopped. Approve the selected DB migration run; keep maintenance active.'
deadline=$((SECONDS + 1800))
while true; do
  assert_stopped momo-result "${RUNTIME_FLY_API_TOKEN}"
  assert_stopped momo-result-analysis "${WORKER_FLY_API_TOKEN}"
  run="$(read_migration_run)"
  if jq -e '.status == "completed"' <<< "${run}" > /dev/null; then
    jq -e '.conclusion == "success" and
      any(.jobs[]; .name == "Migrate Neon" and .conclusion == "success")' \
      <<< "${run}" > /dev/null || {
        echo 'DB migration did not succeed. Machines remain stopped; do not restart old images.' >&2; exit 1;
      }
    break
  fi
  (( SECONDS < deadline )) || {
    echo 'DB approval/migration timed out. Machines remain stopped.' >&2; exit 1;
  }
  sleep 10
done
echo 'Pinned DB migration succeeded. The verified API and Worker candidates may now start.'
