#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${ACTIONLINT_BIN:-}" ]]; then
  [[ -x "${ACTIONLINT_BIN}" ]] || {
    echo "ACTIONLINT_BIN is not executable: ${ACTIONLINT_BIN}" >&2
    exit 1
  }
  exec "${ACTIONLINT_BIN}" "$@"
fi

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint "$@"
fi

if [[ -x "${HOME}/go/bin/actionlint" ]]; then
  exec "${HOME}/go/bin/actionlint" "$@"
fi

echo "actionlint was not found. Install actionlint or add it to PATH." >&2
exit 127
