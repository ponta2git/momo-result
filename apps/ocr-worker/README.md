# momo-result OCR worker

Python OCR worker for Momotetsu result screenshots.

The first milestone is a standalone local accuracy mode that runs without the API server, Redis, or PostgreSQL:

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

## API queue producer contract

For the full contract — DB schema, status transitions, failure codes, ack semantics, idempotency rules, and compatibility policy — see [`docs/api-contract.md`](docs/api-contract.md). The summary below is a quick reference.

`apps/api` owns the Redis Streams producer side. It must create the durable OCR job row first, then enqueue one stream message. Redis is delivery only; the worker always verifies the DB job state before processing.

Required stream fields:

```json
{
  "jobId": "uuid",
  "draftId": "uuid",
  "imageId": "uuid",
  "imagePath": "/tmp/momo-result/uploads/image.jpg",
  "requestedImageType": "auto | total_assets | revenue | incident_log",
  "attempt": "1",
  "enqueuedAt": "2026-04-29T10:00:00Z"
}
```

Optional OCR hints are encoded as a single `ocrHintsJson` string field so the stream contract stays flat and backward-compatible:

```json
{
  "gameTitle": "桃鉄2",
  "layoutFamily": "momotetsu_2",
  "knownPlayerAliases": [
    { "memberId": "member-ponta", "aliases": ["ぽんた", "ぽんた社長"] }
  ],
  "computerPlayerAliases": ["さくま", "さくま社長"]
}
```

These values are hints only. `requestedImageType` may come from the upload slot or manual UI selection; `gameTitle`/`layoutFamily` may select parser profiles; aliases may improve name matching. The worker must still return raw OCR values, warnings, and draft data for user review instead of treating hints as authoritative results.

The production worker defaults to the in-process `tesserocr` engine for throughput. Set `MOMO_OCR_ENGINE=subprocess` when a deployment needs `OCR_TIMEOUT_SECONDS` as a hard per-call process timeout boundary more than the in-process speedup.

The worker reads temporary images but does not delete them. The API keeps source images until the draft is confirmed or cancelled, then applies the server-side retention cleanup policy.

## Development commands

```sh
uv sync
uv run ruff check --fix
uv run ruff format
uv run ruff format --check
uv run ruff check
uv run mypy
uv run pytest
```

Postgres integration tests start a Postgres Testcontainer and apply the `momo-db/drizzle` SQL files.
If `momo-db` is not available as a sibling checkout or under `_deps/momo-db`, set
`MOMO_DB_MIGRATIONS_DIR` to the `drizzle/` directory before running `uv run pytest`.

Use the fix commands before committing local edits. The strict verification gate is:

```sh
uv run ruff format --check && uv run ruff check && uv run mypy && uv run pytest
```

Quality policy:

- Ruff selects `ALL` rules by default and ignores only project-level noise.
- Ruff owns import sorting and formatting.
- Mypy runs in `strict` mode for `src` and `tests`.
- Tests are annotated too, so fixtures and helper types stay explicit.
- Real screenshot calibration files stay outside git under repository-root `ocr_samples/`.
