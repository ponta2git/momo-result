# CI reports

`Run` exposes `coverage`, `runtime-logs`, `analysis-report`,
`analysis-report-state`, and `analysis-summary`. Each command's `--help`
documents its arguments. Exit 2 means invalid arguments; exit 1 means invalid
input or an I/O failure. Diagnostic commands do not decide whether CI should
block: callers retain that decision. Input values and parser errors are never
included in stderr.

- **coverage** preserves the coverage JSON/Markdown shape, metric order,
  percentages rounded to one decimal, and API instrumentation limitation.
  Counts must be nonnegative integers; positive totals must agree with the
  supplied percentage within 0.010000001 percentage points. `Unknown` is only
  accepted for zero covered/total and becomes null. Missing reports are allowed
  only with `--allow-missing`; invalid reports always fail. Both conditions
  replace previous summaries with empty metrics. JSON must be one complete
  value; API XML must have one complete, unnamespaced `scoverage` root.
- **runtime-logs** reads one JSON value per line. Non-object/malformed lines
  become counts. Only identifiers matching `[A-Za-z0-9_.-]{1,80}` and aggregate
  counts are emitted; message fields are never copied. Results are sorted by
  app/component/level/event. Empty input produces an empty summary. An input
  I/O failure fails the collector without emitting a partial summary.
- **analysis-report** accepts one maintenance report and publishes only the
  existing maintenance allowlist, canonical kind, and exact integer counts.
  Unknown enum/digest values fail. Additional input fields are discarded.
  `--from-log` instead reads a stream of JSON values and requires exactly one
  object with both `schemaVersion` and `planDigest`, matching the maintenance
  caller's candidate selection. All input must parse; malformed suffixes and
  multiple candidates fail, even if one candidate is valid. Existing output is
  removed before validation and new evidence is published by rename only on
  success. Input/output must be distinct regular files when present; symlink
  inputs/outputs and hardlinked aliases are rejected.
- **analysis-report-state** validates the same single-document contract before
  emitting only status, a tab, planDigest, and a newline for Shell control flow.
  A planned state additionally requires a nonempty digest, preserving the
  inspected-plan guard before the caller can apply it.
- **analysis-summary** revalidates reports before rendering Markdown. Missing
  reports are allowed; invalid reports fail without copying their values.
  A non-success operation emits follow-up text and a fixed CI error annotation,
  but returns zero when rendering succeeds, preserving the caller's operation
  result. A successful planned/running operation explains the next command.

The producer-facing contracts remain the existing report shapes and caller
guards. Package types describe safe output, while tests cover parsing,
rejection, stale evidence, non-disclosure, and exit behavior. Shell integration
tests cover command supply and orchestration rather than duplicating these
parser cases.
