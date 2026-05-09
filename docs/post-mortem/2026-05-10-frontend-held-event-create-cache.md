# Postmortem: Held event creation did not update the review dropdown

Date: 2026-05-10

Scope: frontend only (`apps/web/src/features/matches/workspace`, TanStack Query cache)

Status: resolved in working tree. Durable rules updated.

## Summary

On the OCR draft review screen, creating a new held event from "一覧にない開催履歴を追加" copied
the created event timestamp into "開催日時", but the new event did not appear in the "開催履歴"
dropdown.

The API call succeeded and the form state was partially updated (`heldEventId`, `matchNoInEvent`,
`playedAt`). The bug was that the dropdown options came from the `heldEventKeys.scope("workspace")`
TanStack Query cache, and the mutation success handler did not update that cache or refetch it before
setting the selected value.

The remediation updates the workspace held-event list cache immediately after create success,
invalidates the broader held-event namespace, and adds a user-event regression test for the exact OCR
draft review interaction.

## Impact

- Users could create a held event but not see it in the held-event dropdown on the same screen.
- The UI presented contradictory state: "開催日時" changed, but "開催履歴" did not show the created
  option.
- No data loss was observed. The held event was created in the backend.
- The failure increased the risk of users creating duplicate held events or losing confidence in
  whether the selected event would be used.

## Timeline

- Before 2026-05-10: `MatchWorkspacePage` created held events and patched form state, but left
  `held-events/workspace` cache unchanged.
- 2026-05-10: User reported that creating a held event from OCR draft review copied the date into
  "開催日時" but did not add it to the "開催履歴" dropdown.
- 2026-05-10: Investigation found that `MatchSetupSection` rendered dropdown options only from
  `heldEventsQuery.data.items`, while `createEventMutation.onSuccess` only patched local form state.
- 2026-05-10: Fix added `queryClient.setQueryData` for `heldEventKeys.scope("workspace")` and
  invalidated `heldEventKeys.all()`.
- 2026-05-10: Regression coverage was added to `DraftReviewPage.test.tsx`.

## Root Causes

### 1. Mutation success updated selected form fields but not the candidate source

The create success handler treated the mutation result as enough to patch the selected value:

```text
created event -> set heldEventId / matchNoInEvent / playedAt
```

But the select options were not derived from those fields. They were derived from the TanStack Query
list response:

```text
heldEventsQuery.data.items -> <option ...>
```

This created a split-brain UI state where the selected ID existed in form state but not in the list
that rendered the select control.

### 2. Refetch/invalidation was assumed rather than modeled

The implementation did not explicitly decide whether create success should:

- optimistically/upsert the created event into the current list cache,
- invalidate and wait for the list refetch, or
- keep a separate local candidate list.

For this workflow, the user expects the new event to be selectable immediately. That requires the
current option source to include the created item before or at the same time as selecting it.

### 3. Existing tests checked the toast, not the select invariant

There was a test for the review notice after creating a held event. It clicked "作成して選択" and
asserted that a toast appeared. That verified the mutation surface but not the broken UI invariant:

```text
If a created held event is selected, the dropdown must also contain an option for that ID.
```

## Contributing Factors

- `MatchWorkspacePage` owns both form state and mutation side effects, while `MatchSetupSection`
  renders options from query data. The boundary made it easy to patch one state source and forget the
  other.
- The generated API response included all data needed to repair the cache, but there was no helper or
  convention requiring create mutations to update affected list caches.
- The failing path was a same-page mutation lifecycle, not a pure render or API wrapper behavior.
  Tests that stop at "mutation happened" are too weak for this class of bug.

## Test Architecture Assessment

The frontend page/component layer should catch this issue. Backend and HTTP tests can prove the held
event is created, but they cannot prove the current React page reflects the created item in the
dropdown.

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web component/page | UI state, user interaction, mutation success, query cache lifecycle. | The test clicked create and checked only the toast. | Test the exact OCR review interaction and assert select value plus option membership. |
| HTTP/API | Request parsing, response encoding, persistence success. | Not applicable to same-page cache reflection. | No backend test required for this incident. |
| E2E smoke | Cross-service browser behavior. | Could catch this, but a page test is more precise and cheaper. | Keep as component/page coverage unless held-event creation becomes a critical smoke path. |

The added test executes the failing path directly: render OCR draft review, open held-event creation,
click "作成して選択", then assert the "開催履歴" select has value `held-created` and contains an option
with that value.

## What Worked

- The user report was precise enough to identify the split between "開催日時" form state and the
  dropdown option list.
- The page already used a shared `heldEventKeys.scope("workspace")` key, so the affected cache was
  easy to target.
- MSW made it straightforward to model a created held event and a list endpoint in the page test.

## What Did Not Work

- The original test oracle was too indirect; a toast does not prove the selected resource exists in
  the control that users interact with.
- The mutation handler had no explicit cache update policy for the list it affected.
- The mental model treated "selected ID updated" as equivalent to "the select is usable".

## Immediate Remediation Completed

- `MatchWorkspacePage` now upserts the created held event into `heldEventKeys.scope("workspace")`.
- `MatchWorkspacePage` invalidates `heldEventKeys.all()` after create success so other held-event
  consumers can refresh.
- `DraftReviewPage.test.tsx` now verifies the created held event is both selected and present in the
  dropdown options.

## Verification Performed

- `pnpm --dir apps/web test -- DraftReviewPage.test.tsx` passed.
- `pnpm --dir apps/web lint` passed.
- `pnpm --dir apps/web format:check` passed.
- `pnpm --dir apps/web typecheck` passed.

No backend or DB integration test was run because the failure was limited to frontend cache
reflection after a successful create response.

## Residual Risk

- Other create mutations may patch form state or navigate after success without updating the list
  cache that powers the visible control. They were not audited as part of this incident.
- The current fix prepends and sorts the created held event in the workspace cache. This matches the
  backend ordering for the current fields, but future held-event list filtering/search would need a
  more specific cache update policy.

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep a durable architecture rule that create/update mutations must refresh or patch any query cache that powers the currently selected candidate list. | `docs/architecture.md` | Server State rules mention mutation success cache reflection, not only query-key shape and invalidation range. | Reviewers can point to the rule when a mutation sets a selected ID. |
| P0 | Keep a durable test rule for mutation-driven selects/lists. | `docs/test-rule.md` | Web tests require asserting both selected value and candidate option/list membership when a mutation creates the selected resource. | A future fix includes a direct user-event test or explains why no visible candidate list exists. |
| P1 | Audit other frontend create mutations that immediately select or display the created resource. | `apps/web/src/features/**` | Each such mutation either updates the relevant cache, invalidates and waits/refetches appropriately, or documents why no same-page reflection is needed. | `rg "useMutation|setQueryData|invalidateQueries" apps/web/src/features apps/web/src/shared` plus targeted tests for any changed flow. |

## Changed Mental Model

Replace:

```text
After a create mutation, setting the selected ID is enough for the UI to reflect the new resource.
```

With:

```text
After a create mutation, every visible source of truth must be updated consistently: selected value,
candidate list/query cache, and any derived labels/counts.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Mutation success that selects a newly created resource must also refresh or patch the list/query cache that renders the selectable candidates. | `docs/architecture.md` |
| Tests for mutation-created select options must assert the selected value and the option/list membership, not only a toast or success message. | `docs/test-rule.md` |
| Keep a short reflection prompt for TanStack Query mutation cache reflection. | `docs/post-mortem/lessons.md` |
