#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <candidate-commit> <current-master-commit>" >&2
  exit 2
fi

candidate_commit="$1"
current_master_commit="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for commit in "${candidate_commit}" "${current_master_commit}"; do
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "Runtime release commits must be full lowercase commit SHAs." >&2
    exit 1
  }
done

git cat-file -e "${candidate_commit}^{commit}"
git cat-file -e "${current_master_commit}^{commit}"

if [[ "${candidate_commit}" == "${current_master_commit}" ]]; then
  exit 0
fi

git merge-base --is-ancestor "${candidate_commit}" "${current_master_commit}" || {
  echo "The release candidate is not an ancestor of current master." >&2
  exit 1
}

runtime_scope="$(
  "${script_dir}/classify-git-range.sh" \
    "${candidate_commit}" "${current_master_commit}" |
    sed -n 's/^runtime=//p'
)"
case "${runtime_scope}" in
  false) ;;
  true)
    echo "A newer runtime-relevant change superseded this release candidate." >&2
    exit 1
    ;;
  *)
    echo "The current master runtime scope could not be classified." >&2
    exit 1
    ;;
esac
