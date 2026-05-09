# GitHub Copilot instructions

このリポジトリで作業する前に、必ず以下を読むこと。

1. `requirements/base.md`
2. `requirements/system-design.md`
3. `AGENTS.md`

`AGENTS.md` が全エージェント共通の詳細指示であり、このファイルはGitHub Copilot向けの入口である。

---

## Project summary

このアプリは、毎週開催している深夜の桃鉄1年勝負の結果を記録し、CSV/TSVとして出力するためのWebアプリケーションである。

MVPでは、Discord OAuthログイン、固定4名だけの仲間内運用、開催履歴、結果作成/編集/確定、画像取り込み、OCR下書き、手修正、マスタ管理、CSV/TSVダウンロードを実装対象とする。

---

## Required architecture

- Monorepo layout:
  - `apps/web`: React/Vite SPA
  - `apps/api`: Scala 3 API server
  - `apps/ocr-worker`: Python OCR worker
- web:
  - React Router
  - TanStack Query with Suspense
  - Conform + Zod
  - Tailwind CSS
  - self-managed components, no UI component library by default
  - `openapi-typescript` for generated API types
  - thin handwritten `fetch` wrapper
- api:
  - Scala 3
  - Tapir
  - http4s
  - Cats Effect
  - Doobie
  - Tapir endpoint definitions are the source of truth for OpenAPI
- ocr-worker:
  - Python
  - uv
  - Tesseract + OpenCV/Pillow as first-choice OCR stack
  - image-type-specific parsers with shared preprocessing
- DB:
  - Neon PostgreSQL shared with the summit app
  - schema migrations are owned by the summit app during MVP
- Queue:
  - Upstash Redis Streams
  - DB is the source of truth for OCR job state
- Production:
  - single Fly.io app/domain
  - nginx serves SPA static assets and reverse-proxies API requests
  - nginx, API, and OCR worker run in the same VM as separate supervisord-managed processes

---

## Non-negotiable product rules

- Login is Discord OAuth.
- Only the fixed four summit members can log in.
- Initial admin is `ぽんた`.
- Result confirmation requires date/time, game title, season, owner, map, all four play orders, and all four ranks.
- All four ranks must be unique values from 1 to 4.
- Assets and revenue are stored as integer values in ten-thousand-yen units.
- Rank is not calculated from asset amount; OCR/manual rank is authoritative.
- Uploaded images are temporary only.
- Images are downloadable until OCR completes, then deleted.
- Images must never be permanently stored on the server.
- OCR/analysis must not use external APIs.
- CSV/TSV download is private and available only from the logged-in UI.
- CSV/TSV output is one row per player result and follows the column order in `requirements/base.md`.

---

## Security and correctness requirements

- Use HttpOnly Secure Cookie server-side sessions after Discord OAuth.
- Store sessions in PostgreSQL/Neon.
- Use SameSite=Lax cookies and require CSRF tokens for state-changing APIs.
- Never commit secrets.
- Do not log OAuth tokens, session IDs, CSRF tokens, image content, or secrets.
- Validate upload type and size; allowed formats are PNG/JPEG/WebP and max size is 3MB per image.
- Add light rate limiting for login, image upload, and CSV/TSV download.
- Do not swallow failures. Surface user-actionable errors.
- Physical deletion is allowed only with explicit confirmation.

---

## Testing and quality

When implementing code, add or update relevant tests.

Expected tooling:

- web: Vitest + Testing Library, oxlint + oxfmt
- api: MUnit, scalafmt + scalafix
- ocr-worker: pytest, ruff
- E2E: Playwright

CI must eventually cover format, lint, typecheck, unit tests, API integration tests, E2E smoke tests, and build.

Before completing a code task, run the narrowest existing validation commands that cover the change. If commands are not yet available because the project skeleton is still being created, add them as part of the relevant setup task.

---

## Change discipline

- Do not implement MVP-out-of-scope features unless requested.
- Do not change architecture choices without updating `requirements/system-design.md`.
- Do not change business rules without updating `requirements/base.md`.
- Keep shared DB compatibility in mind; summit owns migrations during MVP.
- If a schema change is needed, document the summit-side migration and deploy order.
- Prefer precise, well-tested changes over broad rewrites.
