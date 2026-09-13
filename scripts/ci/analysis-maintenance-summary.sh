#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_STEP_SUMMARY:?required}"
report=analysis-production-artifact/operation-report.json
if [[ -f "${report}" && ! -L "${report}" ]]; then
  {
    printf '### Analysis maintenance\n\n'
    jq -r '"| 状態 | 操作 | 対象 | 完了 | 失敗 |", "| --- | --- | ---: | ---: | ---: |",
      "| \(.status) | \(.action) | \(.targetCount) | \(.completedCount) | \(.failedCount) |",
      "", "判定理由: `\(.reason)`", ""' "${report}"
  } >> "${GITHUB_STEP_SUMMARY}"
fi
if [[ "${OPERATION_RESULT:-failure}" == success ]]; then
  if [[ -f "${report}" ]] && jq -e '.status == "planned" or .status == "running"' "${report}" > /dev/null; then
    printf '確認のみで終了しました。適用・完了確認には `pnpm analysis:maintain` を実行します。\n' >> "${GITHUB_STEP_SUMMARY}"
  fi
  exit 0
fi
cat >> "${GITHUB_STEP_SUMMARY}" <<'TEXT'
### Release follow-up required

The release has not been confirmed complete. Check the failed step and the analysis operation report, if present.

- `reader_or_worker_incompatible`: finish the compatible deployment, then retry.
- `plan_changed_run_check_again`: run `Analysis production operation` with `check`, then `auto`.
- `running`: processing continues durably. Run `Analysis production operation` with `auto` to resume checking.
- `attention_required` with failed targets or an integrity error: investigate the report before retrying; do not create a fresh campaign to hide a failure.
- No report: complete or repair the failed deployment stage before analysis maintenance.

Use `pnpm analysis:maintain check` to inspect or `pnpm analysis:maintain` to reconcile. Both dispatch the protected workflow on master.
After manual recovery, rerun the original deploy run to verify the whole release and publish its release notes.
TEXT
echo '::error::Release follow-up is required. See the job summary and operation evidence.' >&2
