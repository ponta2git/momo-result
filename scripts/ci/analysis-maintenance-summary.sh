#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_STEP_SUMMARY:?required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${script_dir}/ci-tool.sh" analysis-summary analysis-production-artifact/operation-report.json "${OPERATION_RESULT:-failure}" >> "${GITHUB_STEP_SUMMARY}"
