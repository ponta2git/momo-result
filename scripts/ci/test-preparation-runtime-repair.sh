#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PYTHONDONTWRITEBYTECODE=1
node --test "${repo_root}/scripts/ci/preparation-runtime-repair.test.mjs"
python3 "${repo_root}/scripts/ci/preparation-runtime-image.test.py"
