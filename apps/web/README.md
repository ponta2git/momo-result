# apps/web

React/Vite SPA for the Momotetsu OCR intake console and draft review flow.

## Development

```sh
pnpm install
pnpm --filter web generate:api
pnpm --filter web dev
```

Vite proxies `/api`, `/healthz`, and `/openapi.yaml` to `http://localhost:8080`, so the web app always uses relative URLs.

## OCR review flow

1. Open `/ocr/new`, capture or upload result images, arrange them into the three classification trays, then run `OCRにかけて下書き保存`.
2. After at least one draft is saved, use `下書きを確認する` to open `/review/:matchSessionId` with the draft IDs in the query string.
3. On the review screen, choose or create the target `held_events`, confirm the match context, edit the four player rows inline, and run the final confirmation.

The review screen can continue with missing draft categories; those fields become manual-entry values. Final confirmation still requires a selected held event and valid fixed-four-player result.

In Vite dev mode, `/ocr/new` also shows `サンプル下書きで確認`. This opens `/review/dev-sample?sample=1` with local fixture OCR payloads so the merge/review UI can be checked without a running OCR worker or valid result screenshots.

## Dev user

The API dev auth header is resolved in this order:

1. `VITE_DEV_USER`
2. `localStorage["momoresult.devUser"]`
3. The in-page Dev User picker

Allowed local users must match API `DEV_MEMBER_IDS`: `ponta,akane-mami,otaka,eu`.

## Quality commands

```sh
pnpm --filter web generate:api
pnpm --filter web format:check
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test:run
pnpm --filter web build
```

## Troubleshooting

- If OpenAPI generation fails on `apps/api/openapi.yaml`, the script copies it to `.cache/openapi.json` and retries.
- If OCR jobs remain queued locally, the OCR worker or queue integration may not be running. Unit tests use MSW to cover succeeded and failed UI states.
- Uploads are pre-validated in the browser, but server-side magic-byte validation remains the source of truth.
