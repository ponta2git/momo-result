#!/usr/bin/env bash
set -euo pipefail

[[ "$#" -eq 1 ]] || {
  echo "Usage: update-java-trust.sh <blocked.certs>" >&2
  exit 1
}

source_list="$1"
target_list="${JAVA_HOME:?JAVA_HOME is required}/lib/security/blocked.certs"
for list in "${source_list}" "${target_list}"; do
  [[ "$(sed -n '/^Algorithm=/p' "${list}" | sort -u)" == 'Algorithm=SHA-256' ]] || {
    echo "Java certificate blocklist must use SHA-256: ${list}" >&2
    exit 1
  }
done

{ printf '\n'; cat "${source_list}"; } >> "${target_list}"
