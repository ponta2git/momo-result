# Structured CI commands

`ci-tool` parses reports, creates metadata, and validates release evidence.
Shell owns provider commands, process exit status, polling, file handoff, and
GitHub outputs. The tool does not deploy or contact providers.

Build once from the checkout and explicitly select that binary:

```sh
scripts/ci/build-ci-tool.sh /tmp/momo-ci-tool
export MOMO_CI_TOOL=/tmp/momo-ci-tool
scripts/ci/ci-tool.sh --help
scripts/ci/ci-tool.sh runtime-candidate --help
```

The launcher supplies the checkout root for pinned config checks. Input/output
files remain explicit arguments. It never rebuilds or silently reuses a cached
binary. CI uses the setup action once per consuming job; `pnpm test:policy`
builds once before running the Shell contracts. Individual Shell suites accept
the same `MOMO_CI_TOOL` environment variable.

Command contracts and focused tests live with their owning packages:

- [Reports](../../internal/cireport/README.md): coverage, runtime logs, maintenance report sanitization/state/summary.
- [Evidence](../../internal/cievidence/README.md): candidate and deployment provenance, archive identity, readiness and postdeploy guards.
- [Producers](../../internal/ciproducer/README.md): metadata generation and allowlisted provider response interpretation.

Invalid input never produces success evidence. Errors omit raw provider data.
The caller keeps diagnostic failures nonblocking and required release guards
blocking; that policy belongs to workflows and orchestration scripts.
