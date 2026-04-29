# momo-result OCR worker

Python OCR worker for Momotetsu result screenshots.

The first milestone is a standalone local accuracy mode that runs without the API server, Redis, or PostgreSQL:

```sh
uv sync
uv run momo-ocr analyze --image ../../ocr_samples/01_.jpg --type auto --output ./out/01_.json --debug-dir ./out/debug/01_
uv run momo-ocr batch --input-dir ../../ocr_samples --report ./out/accuracy-report.json
```

Real game screenshots are expected to live in the repository-root `ocr_samples/` directory, which is ignored by git. CI fixtures must be synthetic and license-safe.

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
