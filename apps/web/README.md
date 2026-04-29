# apps/web

React/Vite SPA for the Momotetsu OCR intake console.

## Development

```sh
pnpm install
pnpm --filter web generate:api
pnpm --filter web dev
```

Vite proxies `/api`, `/healthz`, and `/openapi.yaml` to `http://localhost:8080`, so the web app always uses relative URLs.

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
