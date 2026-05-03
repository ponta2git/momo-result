# Postmortem: MastersPage stale query error visibility

Date: 2026-05-03

Scope: frontend only (`apps/web/src/features/masters`)

Status: mitigated by commit `943c1372cca6e50d81df4c7ff1a4e8b2de068ae4`. Follow-up actions remain
for broader frontend recurrence prevention.

## Summary

`MastersPage` could show a master-load failure notice from a cached TanStack Query error while the
same query was already refetching and about to recover. In the observed fix, the page had previously
rendered notices from `query.error` alone. The remediation introduced a query-error visibility guard
that requires the user to be authenticated and the query not to be fetching.

This is the frontend counterpart to the backend `GET /api/matches` DB incident already documented in
`docs/post-mortem/2026-05-03-backend-matches-list-db-errors.md`. The backend postmortem covers the
server-side SQL and migration failures. This document covers the UI state model that made a stale
load error visible during recovery.

## Impact

- Users could see `作品マスタの読み込みに失敗しました` immediately after remount even though the
  refetch was in progress and later succeeded.
- The UI could communicate a current fatal failure when the actual state was transient recovery.
- No data loss or data corruption was observed.
- No production incident report or user count was available in the repository; impact is inferred
  from the fixed UI behavior and regression test.

## Timeline

- Before 2026-05-03 10:06:59 JST: `MastersPage` rendered master-load notices whenever the matching
  query had an `error` object.
- 2026-05-03 10:06:59 JST: Commit `943c1372cca6e50d81df4c7ff1a4e8b2de068ae4` changed the frontend
  error conditions to require authentication and `!query.isFetching`.
- 2026-05-03 10:06:59 JST: The same commit added a `MastersPage` regression test that seeds a
  cached game-title query error, remounts the page, delays a successful refetch, asserts that the
  stale failure notice is not shown, and then verifies recovered data is rendered.

## Root Causes

### 1. Query error presence was treated as current user-visible failure

The page conflated `query.error` with "the current load has failed and no recovery is happening".
TanStack Query can keep the previous error in cache while a remounted observer starts a new fetch.
During that interval, `query.error` alone is a historical signal, not enough evidence for a blocking
error notice.

The corrected frontend model is:

```text
Show a page-level load error only after the query is enabled for the current user and no fetch is in
progress.
```

### 2. Auth-gated query execution and error presentation were not modeled together

The masters queries are enabled only after `useAuth()` succeeds. Before the fix, notice rendering did
not include the same authenticated-user precondition. That made the presentation layer less explicit
than the query execution layer and easier to get wrong when cached query state was present.

### 3. The test suite covered happy-path loading, not recovery from cached failure

Existing `MastersPage` tests verified rendering, creation, fixed incident masters, and handoff
navigation. They did not seed a failed query cache and then exercise the remount/refetch path. The
missing test was not another success fixture; it was a lifecycle test for a stale error becoming
invisible while the real request was recovering.

## Contributing Factors

- The global `queryClient` is intentionally shared in tests and cleared after each test, which keeps
  normal tests deterministic but does not naturally exercise persisted query-cache failure states.
- The UI had no shared convention for "blocking load error" versus "historical/background refetch
  error"; each page can make that decision locally.
- A mental model from synchronous request handling leaked into frontend state handling:

```text
error object exists -> show error
```

This is too coarse for TanStack Query lifecycle state.

## Test Architecture Assessment

The frontend page/component layer should catch this issue. Backend, repository, and HTTP tests cannot
detect whether a React page displays a stale cached error during refetch.

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web component/page | UI state, user interaction, API error display, TanStack Query lifecycle behavior. | The pre-fix tests did not exercise cached error -> remount -> refetch success. | Add page tests that seed query cache or MSW failure state and assert the exact visible UI during recovery. |
| E2E smoke | Core cross-service flows in an integrated app. | E2E would be expensive and brittle for a cache-lifecycle edge case. | Keep this as component/page coverage unless a core user flow regresses in the browser. |
| HTTP/API | Response status and payload shape. | Not applicable to stale UI visibility. | No additional backend test required for this frontend issue. |

The regression test added in the commit executes the correct failing path: it renders `MastersPage`
with the same `QueryClientProvider`, seeds the `gameTitles("ponta")` query with an error, performs a
delayed successful MSW response, and checks that the stale notice is absent while recovery proceeds.

## What Worked

- The regression test models the actual lifecycle instead of only checking eventual success.
- MSW made it easy to represent a delayed recovery response without involving the backend.
- The local `shouldShowQueryError` helper made the page's error visibility rule explicit.

## What Did Not Work

- The original page used `query.error` directly in render logic.
- Tests did not include a query-cache recovery case before the fix.
- The project rules mentioned web API error display generally, but did not call out TanStack Query
  stale error/refetch behavior.

## Immediate Remediation Completed

- Added `shouldShowQueryError(query)` to show load errors only when `query.error` exists and
  `query.isFetching` is false.
- Guarded master-load notices with `auth.isAuthenticated`.
- Added `MastersPage` regression coverage for cached error plus delayed successful refetch.

## Verification Performed

- `pnpm --dir apps/web test:run src/features/masters/MastersPage.test.tsx` passed with 5 tests.
- `git diff --check` passed.

## Residual Risk

- Other pages still render query errors with page-local conditions such as `isError` or direct query
  status checks. They may be correct for their UX, but they have not been audited against stale
  cached error/refetch behavior.
- The helper is local to `MastersPage`; if several pages need the same blocking-load semantics, a
  shared helper or component should replace copy-pasted conditions.

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep a durable rule for TanStack Query load-error tests. | `docs/test-rule.md` | Web test rules require cached-error/refetch coverage when changing page-level API error display. | A future frontend error-display change names the relevant cache/refetch test or explains why it is not applicable. |
| P0 | Keep an implementation rule for TanStack Query error visibility. | `docs/architecture.md` | Web architecture says `query.error` alone is not enough for blocking load notices. | Review of a query error UI can point to the architecture rule. |
| P1 | Audit other query-driven pages for stale error visibility. | `apps/web/src/features/**` | Each page that displays query load errors has an explicit terminal-error condition or a documented reason it can use simpler state. | `rg "isError|query.error|読み込みに失敗" apps/web/src/features` plus targeted Vitest updates where needed. |
| P1 | Promote a shared helper if two or more pages need identical blocking-load semantics. | `apps/web/src/shared` or feature-local shared module | Reused code expresses the common condition and page tests cover at least one cached-error recovery path. | `pnpm --dir apps/web test:run <affected tests>` |

## Changed Mental Model

Replace:

```text
TanStack Query has an error object, so the page should show a load failure.
```

With:

```text
For page-level load failures, error visibility must account for whether the query is enabled for the
current user and whether a refetch is already in progress.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Do not use `query.error` alone for blocking TanStack Query load-error notices. | `docs/architecture.md` |
| When changing web API error display, test cached-error/remount/refetch behavior when applicable. | `docs/test-rule.md` |
| Keep a short reflection prompt for future frontend API error visibility work. | `docs/post-mortem/lessons.md` |
