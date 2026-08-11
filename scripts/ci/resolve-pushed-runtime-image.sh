#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: $0 <runtime-image-tag>" >&2
  exit 2
fi

image_ref="$1"
[[ "${image_ref}" =~ ^registry\.fly\.io/momo-result:[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$ ]] || {
  echo "Runtime image tag does not have the trusted candidate format." >&2
  exit 1
}

repository="${image_ref%:*}"
registry_ref="$(
  docker image inspect "${image_ref}" --format '{{json .RepoDigests}}' |
    jq -er --arg repository "${repository}" '
      if type == "array" then
        map(select(startswith($repository + "@sha256:"))) | unique
      else
        []
      end |
      if length == 1 then .[0]
      else error("expected exactly one pushed repository digest")
      end
    '
)" || {
  echo "Docker did not expose exactly one pushed runtime repository digest." >&2
  exit 1
}

registry_digest="${registry_ref#*@}"
[[ "${registry_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "${registry_ref}" == "${repository}@${registry_digest}" ]] || exit 1
printf '%s\n' "${registry_ref}"
