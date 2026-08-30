#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <pull-request-body-file> <release-notes-file>" >&2
  exit 2
fi

body_file="$1"
notes_file="$2"

[[ -f "${body_file}" ]] || {
  echo "Pull request body file does not exist: ${body_file}" >&2
  exit 1
}

temp_notes="$(mktemp "${TMPDIR:-/tmp}/momo-release-notes.XXXXXX")"
trap 'rm -f -- "${temp_notes}"' EXIT

if ! awk '
  /^## Release notes[[:space:]]*$/ {
    heading_count++
    capture = heading_count == 1
    next
  }
  capture && /^##[[:space:]]+/ {
    capture = 0
  }
  capture {
    lines[++line_count] = $0
  }
  END {
    if (heading_count != 1) {
      exit 2
    }

    first = 1
    while (first <= line_count && lines[first] !~ /[^[:space:]]/) {
      first++
    }
    last = line_count
    while (last >= first && lines[last] !~ /[^[:space:]]/) {
      last--
    }
    if (first > last) {
      exit 3
    }

    for (line_number = first; line_number <= last; line_number++) {
      print lines[line_number]
    }
  }
' "${body_file}" > "${temp_notes}"; then
  echo "Release PR must contain exactly one non-empty '## Release notes' section." >&2
  exit 1
fi

normalized="$(tr '[:upper:]' '[:lower:]' < "${temp_notes}" | tr -d '[:space:]')"
case "${normalized}" in
  n/a | na | none | なし)
    echo "Release PR notes must describe the release; placeholders are not allowed." >&2
    exit 1
    ;;
esac

cp -- "${temp_notes}" "${notes_file}"
