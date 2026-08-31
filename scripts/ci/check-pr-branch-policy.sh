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

resolve_develop_snapshot() {
  local release_head="$1"
  local expected_master="$2"
  local current_develop="$3"
  local label="$4"
  local -a head_commit
  local head_parent_count
  local release_snapshot
  local synchronized_master

  if git merge-base --is-ancestor "${release_head}" "${current_develop}"; then
    printf '%s\n' "${release_head}"
    return
  fi

  read -r -a head_commit <<< "$(git rev-list --parents -n 1 "${release_head}")"
  head_parent_count="$((${#head_commit[@]} - 1))"
  [[ "${head_parent_count}" -eq 2 ]] || {
    echo "${label} must point to a develop commit or wrap one in a single master synchronization merge." >&2
    return 1
  }

  release_snapshot="${head_commit[1]}"
  synchronized_master="${head_commit[2]}"
  [[ "${synchronized_master}" == "${expected_master}" ]] || {
    echo "${label} synchronization merge must use the expected master as its second parent." >&2
    return 1
  }
  git merge-base --is-ancestor "${release_snapshot}" "${current_develop}" || {
    echo "${label} synchronization merge must use an existing develop commit as its first parent." >&2
    return 1
  }
  [[ "$(git rev-parse "${release_head}^{tree}")" == "$(git rev-parse "${release_snapshot}^{tree}")" ]] || {
    echo "${label} synchronization merge must not change the selected develop snapshot." >&2
    return 1
  }

  printf '%s\n' "${release_snapshot}"
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

    release_snapshot="$(resolve_develop_snapshot \
      "${head_sha}" "${base_sha}" "${develop_sha}" "Release branch")"

    released_snapshot="${base_sha}"
    if ! git merge-base --is-ancestor "${base_sha}" "${release_snapshot}"; then
      if ! previous_release_head="$(git rev-parse --verify "${base_sha}^2" 2>/dev/null)" ||
        ! previous_master="$(git rev-parse --verify "${base_sha}^1" 2>/dev/null)"; then
        echo "Release snapshot does not contain the previously released snapshot." >&2
        exit 1
      fi
      released_snapshot="$(resolve_develop_snapshot \
        "${previous_release_head}" "${previous_master}" "${develop_sha}" \
        "Previously released branch")"
    fi

    git merge-base --is-ancestor "${released_snapshot}" "${release_snapshot}" || {
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
