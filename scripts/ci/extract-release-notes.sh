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
  # PR templates commonly contain hidden editing instructions. They neither
  # define a section nor count as the public description of a release.
  function visible_text(line, start, finish, result) {
    result = ""
    while (length(line)) {
      if (in_comment) {
        finish = index(line, "-->")
        if (!finish) return result
        line = substr(line, finish + 3)
        in_comment = 0
      } else {
        start = index(line, "<!--")
        if (!start) return result line
        result = result substr(line, 1, start - 1)
        line = substr(line, start + 4)
        in_comment = 1
      }
    }
    return result
  }
  { visible = visible_text($0) }
  visible ~ /^## Release notes[[:space:]]*$/ {
    heading_count++
    capture = heading_count == 1
    next
  }
  capture && visible ~ /^##?[[:space:]]+/ {
    capture = 0
  }
  capture {
    lines[++line_count] = $0
    normalized = tolower(visible)
    sub(/^[[:space:]]*([-*+]|[0-9]+[.)])[[:space:]]+/, "", normalized)
    gsub(/[[:space:]`*_]/, "", normalized)
    if (normalized != "" && normalized !~ /^(n\/a|na|none|なし|tbd|todo)$/) {
      has_description = 1
    }
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
    if (first > last || !has_description) {
      exit 3
    }

    for (line_number = first; line_number <= last; line_number++) {
      print lines[line_number]
    }
  }
' "${body_file}" > "${temp_notes}"; then
  echo "Release PR must contain exactly one '## Release notes' section with a description, not only comments or placeholders." >&2
  exit 1
fi

cp -- "${temp_notes}" "${notes_file}"
