#!/usr/bin/env bash
# The GitHub environment supplies the same approval and exclusion as a release.
set -euo pipefail
operation="${1:-auto}"
[[ "$#" -le 1 ]] || exit 2
case "${operation}" in auto|promote|backfill|check) ;; *) echo 'Usage: pnpm analysis:maintain [auto|promote|backfill|check]' >&2; exit 2 ;; esac
exec gh workflow run analysis-production.yml --ref master -f "operation=${operation}"
