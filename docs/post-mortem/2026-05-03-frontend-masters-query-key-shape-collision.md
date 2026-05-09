# Postmortem: MastersPage query key data-shape collision

Date: 2026-05-03

Scope: frontend only (`apps/web/src/features/masters`, TanStack Query cache)

Status: mitigated in working tree. Follow-up actions remain for broader query-key hygiene.

## Summary

Opening the master management screen could crash with:

```text
gameTitles.find is not a function
```

`MastersPage` expected `gameTitles` to be an array, but TanStack Query returned a cached object from
another screen. OCR/setup and review screens used the query key `["masters", "game-titles", member]`
with `listGameTitles`, whose data shape is `{ items: [...] }`. The master management screen used the
same key with `fetchGameTitles`, whose data shape is a sorted array. When a user visited a screen
that populated the list-response cache and then navigated to `/admin/masters`, `buildMasterViewModel`
called `.find()` on that object.

The immediate remediation separated the master management cache namespace to `masters-admin` and
added a regression test that seeds the conflicting OCR/setup cache shape before rendering
`MastersPage`.

## Impact

- Users navigating to the master screen after using another master-consuming screen could hit an
  application error and lose access to master management.
- The failure was a frontend render crash, not a backend/API failure.
- No data loss or data corruption was observed.
- The exact affected user count is unknown; impact is inferred from the reported local browser error
  and the failing execution path.

## Timeline

- Before 2026-05-03: OCR/setup and review pages cached master list responses under
  `["masters", ...]`.
- Before 2026-05-03: `MastersPage` also used `["masters", ...]`, but its query function transformed
  responses into arrays.
- 2026-05-03: User reported `gameTitles.find is not a function` when opening the master screen.
- 2026-05-03: Diagnosis identified a TanStack Query key collision between two different data shapes.
- 2026-05-03: Immediate fix changed master management query keys to `["masters-admin", ...]`.
- 2026-05-03: Regression test added a cached `{ items: [...] }` entry for the old OCR/setup key and
  verified `MastersPage` no longer reuses it.

## Root Causes

### 1. Query keys did not encode data-shape ownership

The key represented the resource (`masters/game-titles`) but not the shape contract of the cached
value. Two query functions with incompatible return types shared one key:

```text
listGameTitles() -> { items: GameTitle[] }
fetchGameTitles() -> GameTitle[]
```

TanStack Query treats the query key as the identity of the cached data. If the key is identical, the
cached value is assumed to satisfy the same contract. That assumption was false.

### 2. Feature-local API wrappers hid a shared cache contract

`shared/api/masters.ts` exposes generated API response shapes. `features/masters/masterApi.ts`
normalizes those responses into sorted arrays. Both are valid API layers, but the query key did not
make it clear which layer owned the cache value.

The changed mental model is:

```text
Query key identity includes both the backend resource and the frontend data shape stored under it.
```

### 3. Tests rendered `MastersPage` with a clean cache only

Existing `MastersPage` tests validated happy-path rendering, creation, fixed incident masters,
handoff return, and stale query-error visibility. They did not simulate the real navigation sequence
where another page had already populated the same query key with a different shape.

## Contributing Factors

- TanStack Query cache is global within the app provider, so cross-page cache collisions can occur
  without direct imports between pages.
- TypeScript did not catch the issue because each `useQuery` call was locally typed by its own query
  function. The runtime cache key collision bypassed that local type assumption.
- The project had rules for TanStack Query stale error visibility, but not for query-key shape
  ownership.
- The failing path was cross-page state reuse, while tests mostly exercised each page as an isolated
  component.

## Test Architecture Assessment

The frontend page/component layer should catch this issue. Backend, HTTP, and DB tests cannot detect
whether two React pages share a client-side cache key with incompatible shapes.

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web component/page | UI rendering, query cache lifecycle, cross-page cached state assumptions. | Tests mounted `MastersPage` with an empty or page-owned cache only. | Add a page test that seeds a cache entry with the shape produced by another page and renders the affected page. |
| E2E smoke | Core route-to-route flows in an integrated browser. | Could catch the user path, but would be a heavier and less precise signal. | Keep the precise regression at component/page level; add E2E only if this becomes a core smoke path. |
| HTTP/API | Response encoding and status. | Not applicable; the API response was valid. | No backend test required for this frontend cache issue. |

The added regression test executes the failing path directly by placing `{ items: [...] }` under
`["masters", "game-titles", "sample-user"]` before rendering `MastersPage`.

## What Worked

- The stack trace pointed directly to `buildMasterViewModel`, making the expected data shape obvious.
- The previous query-error postmortem had already made cache lifecycle a known investigation area.
- A focused component test could reproduce the collision without a browser E2E harness.

## What Did Not Work

- Query keys were treated as resource identifiers only.
- Type-level correctness of individual query functions was mistaken for runtime cache safety.
- The test suite did not include cross-page cache preconditions for pages that share backend
  resources.

## Immediate Remediation Completed

- Changed `features/masters/masterApi.ts` query keys from `["masters", ...]` to
  `["masters-admin", ...]`.
- Added `MastersPage` regression coverage that seeds the old OCR/setup list-response cache shape and
  verifies the master page does not reuse it.

## Verification Performed

- `pnpm --dir apps/web test:run -- src/features/masters/MastersPage.test.tsx` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web format:check` passed.
- `pnpm --dir apps/web lint` passed with the existing 8 React Hooks warnings.

## Residual Risk

- Other pages may still share query keys between raw API response shapes and transformed view-model
  shapes. They have not been audited.
- Separating admin cache keys means admin mutations must intentionally invalidate any consumer-facing
  master caches that should refresh immediately. Default stale refetch may be sufficient for remount
  flows, but this should be reviewed rather than assumed.
- The regression covers game titles. Map, season, and incident master keys use the same corrected
  namespace pattern, but equivalent cross-shape tests were not added for every key.

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep a durable rule that a TanStack Query key must identify the cached data shape, not only the backend resource. | `docs/architecture.md` | Web architecture documents query-key ownership and transformed data shape rules. | Reviewers can reject a query key that stores incompatible shapes under the same identity. |
| P0 | Keep a test rule for pages using shared resources with feature-local transformations. | `docs/test-rule.md` | Web page tests must seed or navigate through a conflicting cache shape when changing query keys or query functions for shared resources. | A future query-key change includes a direct cache-shape regression test or explains why no cross-page cache exists. |
| P1 | Audit frontend query keys for raw-response versus transformed-array collisions. | `apps/web/src/features/**`, `apps/web/src/shared/api/**` | Each shared backend resource has either one canonical cached shape, `select`-based derivation, or a namespaced query key for each stored shape. | `rg "queryKey:" apps/web/src` plus targeted tests for any changed keys. |
| P1 | Review master mutation invalidation after key separation. | `apps/web/src/features/masters/MastersPage.tsx` | Creating masters invalidates all cache namespaces that should update immediately after returning to OCR/review flows. | Add/adjust tests if immediate cross-route freshness is required. |

2026-05-04 follow-up status: completed. The audit found no remaining raw-response versus transformed
array collisions under the same key. Master create mutations now invalidate both `masters-admin` and
consumer-facing master cache namespaces, with regression coverage for game title creation.

## Changed Mental Model

Replace:

```text
The query key names the API resource, and TypeScript will keep each useQuery call safe.
```

With:

```text
The query key names the runtime cache value. If two query functions return different shapes, they
must not share a key unless a single canonical cached shape plus `select` is used.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Query keys must include data-shape ownership; do not store raw API responses and transformed arrays under one key. | `docs/architecture.md` |
| When changing query keys/functions for shared frontend resources, test the cross-page cached shape that previously could exist. | `docs/test-rule.md` |
| Keep a short reflection prompt for TanStack Query cache shape collisions. | `docs/post-mortem/lessons.md` |
