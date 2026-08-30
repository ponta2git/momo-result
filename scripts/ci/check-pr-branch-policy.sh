#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 8 ]]; then
  echo "Usage: $0 <base-ref> <head-ref> <head-repository> <repository> <base-sha> <head-sha> <develop-sha-or-empty> <pr-body-file>" >&2
  exit 2
fi

base_ref="$1"
head_ref="$2"
head_repository="$3"
repository="$4"
base_sha="$5"
head_sha="$6"
develop_sha="$7"
pr_body_file="$8"

require_commit() {
  local name="$1"
  local sha="$2"
  [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "Invalid ${name}: ${sha}" >&2
    return 1
  }
  git cat-file -e "${sha}^{commit}" 2>/dev/null || {
    echo "Missing ${name} commit: ${sha}" >&2
    return 1
  }
}

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

    require_commit base-sha "${base_sha}"
    require_commit head-sha "${head_sha}"
    require_commit develop-sha "${develop_sha}"

    released_snapshot="${base_sha}"
    if ! git merge-base --is-ancestor "${base_sha}" "${head_sha}"; then
      if previous_snapshot="$(git rev-parse --verify "${base_sha}^2" 2>/dev/null)" &&
        git merge-base --is-ancestor "${previous_snapshot}" "${head_sha}"; then
        released_snapshot="${previous_snapshot}"
      else
        echo "Release snapshot does not contain the previously released snapshot." >&2
        exit 1
      fi
    fi

    git merge-base --is-ancestor "${head_sha}" "${develop_sha}" || {
      echo "Release branch must point to an existing develop commit without extra commits." >&2
      exit 1
    }
    git merge-base --is-ancestor "${released_snapshot}" "${head_sha}" || {
      echo "Release branch would roll master back to an older snapshot." >&2
      exit 1
    }

    notes_file="$(mktemp "${TMPDIR:-/tmp}/momo-release-pr-notes.XXXXXX")"
    trap 'rm -f -- "${notes_file}"' EXIT
    "$(dirname "${BASH_SOURCE[0]}")/extract-release-notes.sh" \
      "${pr_body_file}" "${notes_file}"
    echo "Release pull request is a valid develop snapshot with release notes."
    ;;
  *)
    echo "Pull requests must target develop or master, not ${base_ref}." >&2
    exit 1
    ;;
esac
