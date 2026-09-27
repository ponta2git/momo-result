# Rust OCR development evaluator

This Go tool runs the hidden, side-effect-free `momo-processing-worker ocr-pilot` command over a local
answer-keyed image directory. It is a development calibration tool, not a production worker or a
release switch.

The evaluator:

- accepts only filename-declared `total_assets`, `revenue`, and `incident_log` screens;
- runs one image at a time with a bounded timeout and bounded process output, recovering its
  process group on Linux/macOS and allowing at most one second for inherited output pipes to close;
- records per-process wall time, user/system CPU time, and peak RSS when the host exposes it;
- counts process failures as incorrect expected fields instead of dropping their denominator;
- writes detailed image and field evidence only to the caller-selected report path; and
- optionally reconstructs field correctness from an existing Python evaluator report and performs
  a deterministic match-cluster bootstrap for the paired Rust-minus-Python accuracy difference.

Paired comparisons require exactly one image of each supported screen per match (36 fields).
Repeated screenshots of one screen cannot substitute for a missing screen. Player matching preserves
the baseline evaluator's play-order-first, name-fallback calibration convention; it is not a separate
measure of identity-recognition accuracy. The direct-order diagnostic reports whether play order
alone resolved an answer-key slot.

Resource summaries contain successful images only; failed attempts remain in the detailed results
and in the accuracy denominator. CPU time and peak RSS are the operating system's process-exit
measurements, not container/cgroup resource measurements or production worker throughput. On hosts
other than Linux/macOS, cancellation stops the direct pilot only.

The paired result is explicitly a development-pilot result. `releaseDecisionAllowed` always remains
false; calibration data cannot establish accuracy on an independent holdout. Release evidence is
selected under the [test policy](../../../../docs/test-rule.md).

Example paths are intentionally omitted because real OCR samples and detailed results are private.
Run `go run ./cmd/ocr-rust-evaluator -h` from `scripts/tools/` for the closed option set.
