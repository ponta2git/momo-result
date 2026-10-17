#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  normal)
    exec scripts/ci/maintenance-control.sh normal-guard
    ;;
  frozen)
    [[ "$#" == 2 && -f "$2" ]] || { echo 'A bound consumers receipt is required.' >&2; exit 2; }
    exec scripts/ci/maintenance-control.sh maintenance-guard consumers "$2"
    ;;
  *) echo 'Unknown deployment mode.' >&2; exit 2 ;;
esac
