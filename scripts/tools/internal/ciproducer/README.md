# CI provenance producers

`Run` receives explicit arguments, stdin, stdout, stderr, and the checkout root.
It does not read provider credentials, invoke commands, contact providers, or
change files. All commands buffer success output until validation completes.
Exit 2 means invalid CLI arguments; exit 1 means invalid/unavailable input or an
I/O failure. Diagnostics do not include input values or provider response bodies.

The `create-*` commands write JSON to stdout; callers own destination files.
They share candidate/deployment guards with `cievidence`, so newly produced
metadata must satisfy the same wire contract used by later workflow runs.

| Command | Explicit arguments | Result |
| --- | --- | --- |
| `create-http4s-patch` | `--repository URL --scala-version VERSION --source-sha SHA --version VERSION` | Four-field patch JSON; source must match checkout `.http4s-ref` |
| `create-runtime-candidate` | `--artifact-dir DIR --run-id ID --run-attempt N --commit SHA --image-ref REF` | Runtime candidate v2; checks recorded image identity/archive checksum, hashes archive and checkout config, validates patch pin |
| `create-analysis-candidate` | Same flags plus `--artifact-id ID --artifact-digest DIGEST` | Analysis candidate v1; checks archive and image records, hashes checkout config, canonicalizes artifact digest |
| `create-runtime-deployment` | `--candidate FILE --run-attempt N --registry-ref REF --source-artifact-id ID --source-artifact-digest DIGEST --manifest FILE --manifest-artifact-id ID --manifest-artifact-digest DIGEST` | Deployment v3; source attempt/commit/run/image identity come from the validated candidate; deployment attempt is explicit |

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
| `runtime-machine-evidence` | `IMAGE_REF` | v1 `singleStartedExactImage` evidence |
| `runtime-machine-id` | `IMAGE_REF` | Validated ID of the single started exact-image machine |
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
and the real consumer validators, including a different producer/deployer
attempt. Provider tests cover stale generations, unrelated/ambiguous digests,
invalid JSON streams, untrusted runs, missing readiness, and evidence redaction.

Network requests, archive transfer/loading, Git ancestry, polling, GitHub output
publication, and deployment sequencing remain with the caller. The fixed JSON
`manifestVerified` and unchanged-worker acknowledgements contain no provider
interpretation and can be written directly by the shell after successful checks.
