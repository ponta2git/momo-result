# Postmortem: OCR source draft stayed visible after match confirmation

Date: 2026-05-10

Scope: frontend request shaping (`apps/web/src/features/draftReview`,
`apps/web/src/features/matches/workspace`) and local DB data repair

Status: resolved in working tree. Local DB data remediated. Durable rules updated.

## Summary

After confirming a match from an OCR draft, the confirmed match was created, but the source
`match_drafts` row stayed in `draft_ready`. The match list therefore showed both the confirmed match
and the still-open OCR draft for the same OCR result.

The root cause was that `draftToMatchForm` correctly carried `matchDraftId` in form state, but
`confirmMatchSchema` did not include `matchDraftId`. Zod stripped the unknown key during parse /
transform, so `POST /api/matches` was sent without the source draft id. The backend treated the
request as a direct manual match creation, inserted `matches`, and intentionally skipped the
`match_drafts -> confirmed` transition.

## Impact

- Users saw a duplicate-looking item in the match list: one confirmed match and one open OCR draft
  pointing at the same OCR draft ids.
- Source image retention metadata was not closed for the affected draft at confirmation time.
- No confirmed match data loss was observed. The `matches` row existed and referenced the correct
  OCR draft ids.
- Local DB contained one affected active draft:
  `d8d3d4ad-20ed-225d-ba89-916f6b7d2e49`.

## Timeline

- 2026-05-10 11:32 JST: OCR capture created `match_draft_id`
  `d8d3d4ad-20ed-225d-ba89-916f6b7d2e49` and three OCR jobs.
- 2026-05-10 11:32 JST: The three OCR jobs succeeded with `attempt_count = 1`.
- 2026-05-10 11:34 JST: `matches.id = 9a06c050-e501-30f2-cf25-f312d6dd1d8e` was created using the
  same three OCR draft ids.
- 2026-05-10: User reported that two drafts seemed to be generated for the same OCR import.
- 2026-05-10: Local DB inspection showed no duplicate OCR job execution; instead, the source
  `match_drafts` row remained `draft_ready` with empty `confirmed_match_id`.
- 2026-05-10: Code inspection found `matchDraftId` was present in `MatchFormValues` but missing from
  `confirmMatchSchema`.
- 2026-05-10: Fix preserved `matchDraftId` in confirm requests and explicitly omitted it from update
  requests.
- 2026-05-10: Local DB row `d8d3d4ad-20ed-225d-ba89-916f6b7d2e49` was repaired to `confirmed` and
  linked to `9a06c050-e501-30f2-cf25-f312d6dd1d8e`.

## Root Causes

### 1. The request schema did not model a non-visible workflow identifier

The review flow had two separate concepts:

```text
form values used by the UI
API request values sent to the backend
```

`matchDraftId` was not a visible form field, but it was a workflow identity required by the backend
to close the source draft. The schema modeled visible fields and OCR draft ids, but omitted the
source `matchDraftId`, so Zod removed it.

### 2. Tests covered the form prefill, not the final confirm payload contract

`draftToMatchForm` had coverage proving that `matchDraftId` entered form state. The missing test was
the next boundary:

```text
MatchFormValues -> ConfirmMatchRequest
```

That boundary is where the data was lost.

### 3. Backend behavior was valid for manual creation, so no server-side error surfaced

`ConfirmMatch` intentionally allows `matchDraftId = None` for direct/manual match creation. With the
field missing, the backend had no way to know the request originated from OCR review. It correctly
created the match and skipped draft confirmation.

### 4. The specification implied two creation paths but did not name the discriminator

The requirements and domain docs said both of these things:

```text
OCR draft -> user edits match_draft -> confirm into matches
manual input can also be confirmed without images
```

That was directionally correct, but not precise enough for implementers. The docs did not state that
`POST /api/matches` has two semantic modes and that `matchDraftId` is the mode discriminator:

```text
matchDraftId present  -> confirm from OCR/source draft; close match_drafts and purge source images
matchDraftId missing  -> direct/manual match creation; do not touch match_drafts
```

The implementation contained this distinction in `ConfirmMatch`, but the frontend request-shaping
code did not have a clear spec-level reason to treat `matchDraftId` as mandatory for the OCR review
path. As a result, `draftIds` looked sufficient because they preserved OCR provenance on the
confirmed match, even though they do not identify or close the source `match_drafts` row.

## Contributing Factors

- The generated `ConfirmMatchRequest` type already included `matchDraftId`, but the hand-written Zod
  schema was not checked against that semantic requirement.
- `toUpdateMatchRequest` reused `toConfirmMatchRequest`, which discouraged adding a confirm-only
  field unless update behavior was considered separately.
- The symptom looked like duplicate OCR import, so the initial investigation focused on double
  submit and Redis/worker idempotency before DB state revealed the real orphaned-draft pattern.
- The domain docs described the high-level OCR flow and allowed manual input, but did not explicitly
  document the shared endpoint's two modes or the difference between `matchDraftId` and `draftIds`.

## Test Architecture Assessment

The frontend pure transformation layer should catch this first. HTTP/API tests can verify that a
present `matchDraftId` closes a draft, but they cannot catch a frontend schema silently removing it.

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web pure transform/schema | Preserve workflow identifiers from route/prefill state into mutation payloads. | `draftToMatchForm` verified form state, but `toConfirmMatchRequest` did not verify payload identity fields. | Test `MatchFormValues -> ConfirmMatchRequest` for `matchDraftId`; test update payload omits confirm-only fields. |
| web component/page | User can confirm from OCR review and send the expected mutation request. | Existing page tests did not assert the outgoing confirm body for source draft closure. | Add page-level request-body coverage if this flow changes again. |
| HTTP/usecase | Distinguish direct/manual creation from OCR-source confirmation. | Backend path existed, but docs did not make the optional field's mode-discriminator role obvious. | Keep domain/API docs explicit; add HTTP/usecase coverage if the confirm endpoint contract changes. |
| DB inspection | Diagnose whether rows are duplicate jobs or orphaned drafts. | Not automated. | Use targeted SQL during incident response; no recurring DB job required. |

## What Worked

- Local DB inspection separated observed facts from speculation: there was one active source
  `match_draft`, three OCR jobs with one attempt each, and one confirmed `matches` row sharing the
  same OCR draft ids.
- Backend design made the data repair straightforward: setting `status = confirmed` and
  `confirmed_match_id` restored the intended relationship.
- Existing pure tests were cheap to extend around `confirmMatchSchema` and `matchFormToRequest`.

## What Did Not Work

- The original regression coverage stopped before the final API request boundary.
- The schema treated hidden workflow identifiers as incidental rather than contract-bearing data.
- The update request helper shared confirm request shaping without an explicit confirm/update field
  policy.
- The specification left the two create/confirm paths implicit. It said manual input can be
  confirmed and OCR drafts can be confirmed, but did not say which request field selects the path or
  what side effects each path must perform.

## Immediate Remediation Completed

- `confirmMatchSchema` now accepts and preserves `matchDraftId`.
- `toUpdateMatchRequest` explicitly removes `matchDraftId`, because the update endpoint does not
  accept it.
- Added tests for:
  - schema preservation of `matchDraftId`,
  - confirm request preservation of `matchDraftId`,
  - update request omission of `matchDraftId`.
- Local DB row `d8d3d4ad-20ed-225d-ba89-916f6b7d2e49` was updated to:
  - `status = confirmed`,
  - `confirmed_match_id = 9a06c050-e501-30f2-cf25-f312d6dd1d8e`,
  - source image retention/deletion timestamps matching the confirmed match creation timestamp.

## Verification Performed

- `pnpm --dir apps/web test:run confirmMatchFormSchema.test.ts matchFormToRequest.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` passed.
- `pnpm --dir apps/web format:check` passed.
- Local DB verification confirmed `match_drafts` now contains one `confirmed` row and no remaining
  `draft_ready` row for the affected OCR result.

No backend integration test was run because the code change was frontend request shaping and the
backend already had the required `matchDraftId` branch.

## Residual Risk

- Other frontend Zod transforms may drop non-visible workflow identifiers if tests only check form
  state and not the outgoing request body.
- A page-level test that captures the actual `POST /api/matches` request from the review screen would
  provide broader protection, but the direct failing boundary is now covered by pure tests.
- The DB repair marked source images as deleted in metadata, but did not physically remove files from
  `/tmp/momo-result/uploads`.

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep a durable test rule that schema/DTO transforms must preserve hidden workflow identifiers required by the target mutation. | `docs/test-rule.md` | Web test rules mention route/prefill-only identifiers and outgoing request payload assertions. | Document review plus this postmortem's tests. |
| P0 | Keep a short lessons prompt for frontend form-to-request transforms. | `docs/post-mortem/lessons.md` | `lessons.md` points future form/schema changes to this failure mode. | Document review. |
| P0 | Document the two match confirmation modes and the role of `matchDraftId` versus `draftIds`. | `docs/domain-rule.md` | Domain rules state that `matchDraftId` closes the source draft and `draftIds` are OCR provenance only. | Document review. |

## Changed Mental Model

Replace:

```text
If a value exists in form state, the confirm mutation will receive it.
```

With:

```text
Form state, schema parse/transform output, and mutation request body are separate contracts. Hidden
workflow identifiers must be modeled and tested at the final request boundary.
```

Also replace:

```text
OCR draft ids in the confirmed match are enough to connect the match back to the OCR workflow.
```

With:

```text
`draftIds` preserve OCR result provenance on the confirmed match. `matchDraftId` identifies the
source work item whose lifecycle must be closed.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Schema/DTO transforms must preserve route/prefill-only identifiers required by the target mutation, and tests must assert the outgoing request payload. | `docs/test-rule.md` |
| Remember form-to-request transform field drops when touching frontend schemas or mutation payload shaping. | `docs/post-mortem/lessons.md` |
| Match confirmation has two modes: direct/manual creation and OCR-source draft confirmation. `matchDraftId` selects the latter and must close the source draft; `draftIds` are not a substitute. | `docs/domain-rule.md` |
