# Rust OCR development evaluator

This Go tool runs the hidden, side-effect-free `momo-analysis ocr-pilot` command over a local
answer-keyed image directory. It is a development calibration tool, not a production worker or a
release switch.

The evaluator:

- accepts only filename-declared `total_assets`, `revenue`, and `incident_log` screens;
- runs one image at a time with a bounded timeout and bounded process output;
- counts process failures as incorrect expected fields instead of dropping their denominator;
- writes detailed image and field evidence only to the caller-selected report path; and
- optionally reconstructs field correctness from an existing Python evaluator report and performs
  a deterministic match-cluster bootstrap for the paired Rust-minus-Python accuracy difference.

The paired result is explicitly a development-pilot result. `releaseDecisionAllowed` always remains
false; an independent holdout and the remaining Stage C gates are still required.

Example paths are intentionally omitted because real OCR samples and detailed results are private.
Run `go run ./cmd/ocr-rust-evaluator -h` from `tools/` for the closed option set.
