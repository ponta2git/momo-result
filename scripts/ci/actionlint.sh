#!/usr/bin/env bash
set -euo pipefail

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint "$@"
fi

if [[ -x "${HOME}/go/bin/actionlint" ]]; then
  exec "${HOME}/go/bin/actionlint" "$@"
fi

echo "actionlint was not found. Install actionlint or add it to PATH." >&2
exit 127
