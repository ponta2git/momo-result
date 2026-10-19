#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 <base-ref> <head-ref> <head-repository> <repository> <pr-body-file>" >&2
  exit 2
fi

base_ref="$1"
head_ref="$2"
head_repository="$3"
repository="$4"
pr_body_file="$5"

case "${base_ref}" in
  develop)
    echo "Normal pull request targets develop."
    ;;
  master)
    [[ "${head_repository}" == "${repository}" ]] || {
      echo "Release pull requests must originate in the same repository." >&2
      exit 1
    }
    [[ "${head_ref}" == release/* && "${head_ref}" != "release/" ]] || {
      echo "Pull requests to master must use a release/* branch." >&2
      exit 1
    }

    notes_file="$(mktemp "${TMPDIR:-/tmp}/momo-release-pr-notes.XXXXXX")"
    trap 'rm -f -- "${notes_file}"' EXIT
    "$(dirname "${BASH_SOURCE[0]}")/extract-release-notes.sh" \
      "${pr_body_file}" "${notes_file}"
    echo "Release pull request source and release notes are valid."
    ;;
  *)
    echo "Pull requests must target develop or master, not ${base_ref}." >&2
    exit 1
    ;;
esac
