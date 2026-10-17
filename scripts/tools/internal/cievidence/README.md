# CI provenance and evidence

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
| `runtime-deployment` | Existing `key=value` deployment outputs. Preserves schema v1/v2/v3/v4 and the recorded producer run/attempt; historical patch revisions are not compared to the current checkout. |
| `runtime-release-selection` | Selected artifact ID/name, producer attempt, and image reference as `key=value`. |
| `analysis-release-selection` | No output. Checks the worker metadata artifact against its producer run/attempt and validates its digest. |
| `postdeploy-evidence` | `{"schemaVersion":1,"status":"ok"}`. Requires one document within the existing size limit and every required check. Legacy version omission remains accepted. Failure uses the existing structured error classification. |
| `worker-readiness` | JSON readiness report. Reads a provider JSON stream and requires all four events for the selected machine/workers with RFC3339 timestamps. Invalid inner application messages are ignored; malformed outer JSON rejects the input. Last occurrence uses stream order. |
| `artifact-digest` | Canonical `sha256:` digest from a lowercase bare or prefixed digest. |
| `analysis-archive` | Verified image ID. Checks archive bytes and sidecars; the caller still owns decompression, Docker loading, and pipeline failure propagation. |
| `image-id-match` | No output. Both IDs must be valid and equal. |
| `file-digest-match` | No output. The actual file hash must equal the supplied bare SHA-256. |

`analysis-candidate` and `runtime-deployment` accept `--config <file>` after their
four positional arguments. The hash comparison completes before candidate or
deployment outputs are emitted. Rollback callers supply the selected revision's
configuration, not the current checkout's configuration.

Metadata creation and validation share private parsed objects, wire guards,
archive/sidecar readers, and checkout pin rules in this package. No JSON
encode/decode round trip is used to cross an internal API.
The validators keep their distinct contracts: provenance records require exact
keys, postdeploy allows additional fields/checks, and readiness consumes a JSON
stream. They do not share an invented universal report schema.

`testdata` contains fixed synthetic baseline records for current candidate
formats, deployment versions, and provider-wrapped readiness events. The archive
bytes are deliberately opaque hash fixtures, not a Docker image. Tests also
cover missing fields, wrong types, extra documents, stale producer identities,
config/archive mismatches, symlinks, and safe errors. These local contracts do
not establish live provider compatibility or successful deployment.

## Metadata creation and provider replies

The `create-*` commands write JSON to stdout; callers own destination files.
All provider commands validate before publishing allowlisted evidence.

| Command | Explicit arguments | Result |
| --- | --- | --- |
| `create-http4s-patch` | `--repository URL --scala-version VERSION --source-sha SHA --version VERSION` | Four-field patch JSON; source must match checkout `.http4s-ref` |
| `create-runtime-candidate` | `--artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF` | Runtime candidate v2; checks recorded image identity/archive checksum, hashes archive and checkout config, validates patch pin |
| `create-analysis-candidate` | Same flags plus `--artifact-id ID --artifact-digest DIGEST` | Analysis candidate v1; checks archive and image records, hashes checkout config, canonicalizes artifact digest |
| `create-runtime-deployment` | `--candidate FILE --run-id ID --run-attempt N --registry-ref REF --source-artifact-id ID --source-artifact-digest DIGEST --manifest FILE --manifest-artifact-id ID --manifest-artifact-digest DIGEST` | Deployment v4; source run/attempt/commit/image identity come from the validated candidate; deployment run/attempt are explicit |

`create-runtime-deployment` validates candidate metadata against checkout config
and patch pin. The caller must still run the archive validator before loading an
image; deployment generation does not reopen or load its archive.

These commands interpret one JSON document on stdin, allowing additional
provider-owned fields but publishing only selected evidence:

| Command | Arguments | Result |
| --- | --- | --- |
| `resolve-pushed-image` | `IMAGE_TAG` | Unique matching immutable repository digest; duplicate identical entries are allowed |
| `resolve-deployment-run` | `OWNER/REPOSITORY` | `candidate_sha` and `run_attempt` output lines after trusted successful deploy-run checks |
| `verify-manifest-artifact` | `DEPLOYMENT_JSON RUN_ID` | No output; verifies provider artifact identity, digest, name, expiry, and workflow run |
| `normal-deployment-completion` | `RUN_ID RUN_ATTEMPT COMMIT` | No output; requires the exact completed normal deployment. A candidate-only or frozen run cannot authorize the ordinary publisher. |
| `frozen-machine-id` / `frozen-machine-start-id` | `runtime\|analysis IMAGE_REF` | Selects the single exact-image machine only when its persistent maintenance mode is frozen; the start selector returns a stopped target or no output for a started target. |
| `frozen-readiness-evidence` | `runtime\|analysis` | Projects successful dedicated readiness into four public fields; ordinary health checks cannot substitute for it. |
| `maintenance-operation-scope` | `RECEIPT_JSON analysis\|publish` | Validated fixed operation arguments as output lines. This does not grant permission; the shared controller validates the receipt and live permit. |
| `maintenance-analysis-evidence` | `RECEIPT_JSON plan\|complete` | Requires the same cutover, epoch, operation, campaign, and plan; completion also requires all targets successful. A read-only plan may report already complete. |
| `maintenance-publish-evidence` | `RECEIPT_JSON run\|artifact\|completion\|provenance` | No output; validates the actual frozen deployment attempt, immutable provenance artifact, completion identity, or original producer binding. All four are required before publication. |
| `runtime-machine-evidence` | `IMAGE_REF` | v1 `singleStartedExactImage` evidence |
| `runtime-machine-id` | `IMAGE_REF` | Validated ID of the single started exact-image machine |
| `runtime-machine-start-id` | `IMAGE_REF` | ID of the single stopped exact-image machine; empty output if already started |
| `analysis-machine-start-id` | `IMAGE_REF RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID` | Stopped machine ID after the enabled deployment configuration and generation checks; empty output if already started |
| `analysis-machine-identity` | None | Tab-separated ID, immutable image, config version for maintenance identity rechecks |
| `analysis-reusable-release` | `IMAGE_REF` | Prior release SHA when the enabled immutable machine/config is reusable; otherwise an empty line |
| `analysis-machine-evidence` | `IMAGE_REF RELEASE_SHA ANALYSIS_WORKER_ID OCR_WORKER_ID` | Allowlisted enabled deployment state after exact image, configuration, and worker generation checks |
| `analysis-secrets` | `ready` or `unstaged` | No output; checks required connection readiness or absence of staged secrets |
| `canonical-json` | None | Compact JSON with recursively sorted object keys and a final newline; used on both manifest hashing paths |
| `public-edge-evidence` | None | v1 status evidence only when the exact runtime edge smoke event succeeds |

The Go canonical output is the baseline for compatibility between releases
after this refactor. It is not a byte-compatibility guarantee with the former
`jq` output. Fixtures cover OCI manifest fields and escaped U+2028/U+2029;
canonicalizing the canonical result preserves its bytes. Numeric lexemes remain
exact (no float64 conversion). Runtime/deployment tests use a frozen v3 document
and the real consumer validators, including different producer/deployer runs and attempts. Provider tests cover stale generations, unrelated/ambiguous digests,
invalid JSON streams, untrusted runs, missing readiness, and evidence redaction.

Network requests, archive transfer/loading, Git ancestry, polling, GitHub output
publication, and deployment sequencing remain with the caller. The fixed JSON
`manifestVerified` and unchanged-worker acknowledgements contain no provider
interpretation and can be written directly by the shell after successful checks.
