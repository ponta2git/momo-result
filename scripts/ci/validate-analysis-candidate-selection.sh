#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 <selection.json> <candidate.json> <run-id> <selection-attempt> <commit>" >&2
  exit 2
fi

selection_file="$1"
candidate_file="$2"
expected_run_id="$3"
expected_selection_attempt="$4"
expected_commit="$5"

for file in "${selection_file}" "${candidate_file}"; do
  [[ -f "${file}" && ! -L "${file}" ]] || {
    echo "Analysis candidate selection inputs must be regular files." >&2
    exit 1
  }
done
[[ "${expected_run_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_selection_attempt}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "${expected_commit}" =~ ^[0-9a-f]{40}$ ]] || exit 1

candidate_sha256="$(sha256sum "${candidate_file}" | cut -d ' ' -f 1)"
jq -e \
  --arg candidateSha256 "${candidate_sha256}" \
  --arg commit "${expected_commit}" \
  --arg runId "${expected_run_id}" \
  --arg selectionRunAttempt "${expected_selection_attempt}" '
    type == "object" and
    keys == [
      "candidateSha256",
      "commit",
      "metadataArtifactDigest",
      "metadataArtifactId",
      "metadataArtifactName",
      "producerRunAttempt",
      "runId",
      "schemaVersion",
      "selectionRunAttempt"
    ] and
    .schemaVersion == 1 and
    .commit == $commit and
    .runId == $runId and
    .selectionRunAttempt == $selectionRunAttempt and
    (.producerRunAttempt | type == "string" and test("^[1-9][0-9]*$")) and
    .metadataArtifactName ==
      ("analysis-candidate-metadata-" + $runId + "-" + .producerRunAttempt) and
    (.metadataArtifactId | type == "string" and test("^[1-9][0-9]*$")) and
    (.metadataArtifactDigest | type == "string" and test("^sha256:[0-9a-f]{64}$")) and
    .candidateSha256 == $candidateSha256
  ' "${selection_file}" > /dev/null || {
  echo "Analysis candidate selection failed its immutable provenance contract." >&2
  exit 1
}

printf 'metadata_artifact_digest=%s\n' "$(jq -r '.metadataArtifactDigest' "${selection_file}")"
printf 'metadata_artifact_id=%s\n' "$(jq -r '.metadataArtifactId' "${selection_file}")"
printf 'metadata_artifact_name=%s\n' "$(jq -r '.metadataArtifactName' "${selection_file}")"
printf 'producer_run_attempt=%s\n' "$(jq -r '.producerRunAttempt' "${selection_file}")"
