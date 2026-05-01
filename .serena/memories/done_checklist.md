When finishing a task in this repo, confirm:
- Implementation matches `docs/requirements/base.md` and relevant rules.
- Scope stayed within the intended task; if not, stop and ask.
- Required checks pass for touched areas.
- Minimum expected checks from docs:
  - Web: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
  - API: `sbt scalafmtCheck`, `sbt scalafix`, `sbt test`
  - OCR worker: `uv run ruff format --check .`, `uv run ruff check .`, `uv run pytest`
- Consider major failure cases and validation paths before calling work done.