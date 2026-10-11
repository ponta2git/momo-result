# CI evidence validation

`ci-tool <command> --help` shows positional arguments. Commands validate local
inputs only; none calls Docker, Git, or a provider. Valid evidence exits `0`,
rejected evidence exits `1`, and argument errors exit `2`. Validation finishes
before success output is written. Errors contain fixed messages, not input
documents or underlying filesystem errors. Caller YAML/Shell decides whether a
nonzero exit blocks its flow.

| Command | Success output / contract |
| --- | --- |
| `runtime-candidate` | No output. Checks the candidate, patch, regular artifact files, actual archive/config hashes, and checkout pin. `repoRoot` supplies `fly.toml` and `.http4s-ref`. |
| `analysis-candidate` | Existing `key=value` candidate outputs after exact identity and digest checks. |
| `runtime-deployment` | Existing `key=value` deployment outputs. Preserves schema v1/v2/v3 and the recorded producer attempt; historical patch revisions are not compared to the current checkout. |
| `runtime-release-selection` | Selected artifact ID/name, producer attempt, and image reference as `key=value`. |
| `analysis-release-selection` | No output. Checks the worker metadata artifact against its producer run/attempt and validates its digest. |
| `postdeploy-evidence` | `{"schemaVersion":1,"status":"ok"}`. Requires one document within the existing size limit and every required check. Legacy version omission remains accepted. Failure uses the existing structured error classification. |
| `worker-readiness` | Existing JSON readiness report. Reads a provider JSON stream and requires all four events for the selected machine/workers. Invalid inner application messages are ignored; malformed outer JSON rejects the input. Last occurrence uses stream order. |
| `artifact-digest` | Canonical `sha256:` digest from a lowercase bare or prefixed digest. |
| `analysis-archive` | Verified image ID. Checks archive bytes and sidecars; the caller still owns decompression, Docker loading, and pipeline failure propagation. |
| `image-id-match` | No output. Both IDs must be valid and equal. |
| `file-digest-match` | No output. The actual file hash must equal the supplied bare SHA-256. |

`analysis-candidate` and `runtime-deployment` accept `--config <file>` after their
four positional arguments. The hash comparison completes before candidate or
deployment outputs are emitted. Rollback callers supply the selected revision's
configuration, not the current checkout's configuration.

Producer commands reuse the exported validators and digest normalization here.
The validators keep their distinct contracts: provenance records require exact
keys, postdeploy allows additional fields/checks, and readiness consumes a JSON
stream. They do not share an invented universal report schema.

`testdata` contains fixed synthetic baseline records for current candidate
formats, deployment versions, and provider-wrapped readiness events. The archive
bytes are deliberately opaque hash fixtures, not a Docker image. Tests also
cover missing fields, wrong types, extra documents, stale producer identities,
config/archive mismatches, symlinks, and safe errors. These local contracts do
not establish live provider compatibility or successful deployment.
