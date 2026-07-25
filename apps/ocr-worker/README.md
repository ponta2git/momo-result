# momo-result OCR worker

Python OCR worker for Momotetsu result screenshots.

For local accuracy work, the standalone commands run without the API server, Redis, or PostgreSQL:

```sh
uv sync
uv run momo-ocr analyze --image ../../ocr_samples/01_.jpg --type auto --output ./out/01_.json --debug-dir ./out/debug/01_
uv run momo-ocr batch --input-dir ../../ocr_samples --report ./out/accuracy-report.json
```

Real game screenshots are expected to live in the repository-root `ocr_samples/` directory, which is ignored by git. CI fixtures must be synthetic and license-safe.

### Holdout convention for accuracy reporting

To prevent overfitting during OCR tuning, `ocr_samples/` follows a simple holdout convention:

- Top-level files in `ocr_samples/` form the **train** set used for calibration.
- Files placed under `ocr_samples/holdout/` form the **holdout** set and must not influence calibration decisions.

The `momo-ocr batch` command exposes this with `--evaluation-set`:

```sh
uv run momo-ocr batch --input-dir ../../ocr_samples --evaluation-set train   --report ./out/train-report.json
uv run momo-ocr batch --input-dir ../../ocr_samples --evaluation-set holdout --report ./out/holdout-report.json
uv run momo-ocr batch --input-dir ../../ocr_samples --evaluation-set all     --report ./out/all-report.json
```

Default is `all`. Report holdout accuracy separately when documenting tuning outcomes; the holdout slice is the one that reflects generalization.

## Contracts and development

The Redis Streams, database lifecycle, payload schemas, and worker acknowledgement rules are maintained in the [OCR queue contract](../../docs/redis-streams-ocr-contract.md). Worker boundaries and implementation rules are in the [architecture guide](../../docs/architecture.md); commands and quality gates are in the [development guide](../../docs/dev-rule.md).

The standalone accuracy evaluator has its own [usage guide](scripts/README.md), including `answers.tsv` matching, filtering, debug output, and timing modes.
