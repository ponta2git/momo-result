# Postmortem: OCR draft match confirmation failed on FK order

Date: 2026-05-18

Scope: backend match confirmation repository (`apps/api`) and PostgreSQL transaction behavior

Status: resolved in working tree. Durable rules updated.

## Summary

`POST /api/matches` failed when confirming a match from an OCR source draft. PostgreSQL rejected the
request with:

```text
insert or update on table "match_drafts" violates foreign key constraint
"match_drafts_confirmed_match_id_matches_id_fk"
```

The repository updated `match_drafts.confirmed_match_id` before inserting the referenced `matches`
row. The operation was in one transaction, but the foreign key is checked at statement time, so
"the transaction will contain both rows by commit" was not enough.

The fix keeps the optimistic/CAS draft-state update, inserts `matches` and child rows, then updates
`confirmed_match_id` after the parent match exists. The transaction still rolls back as a unit if
the match insert fails.

## Impact

- OCR-source match confirmation through `POST /api/matches` returned a server error instead of
  completing.
- Manual/direct match creation without `matchDraftId` was not affected.
- No partial confirmed match data is expected from this failure shape. The failing SQL happened
  before the parent `matches` row was inserted, and the transaction rolled back.
- The source draft remained unconfirmed, so users could retry after the fix.

## Timeline

- 2026-05-18 13:35:41 UTC / 22:35:41 JST: API log recorded a failed `POST /api/matches` with
  PostgreSQL FK violation on `match_drafts.confirmed_match_id`.
- 2026-05-18 22:38 JST: Code inspection found
  `PostgresMatchConfirmationRepository.confirm` updated `confirmed_match_id` before
  `insertMatchCascade`.
- 2026-05-18 22:38 JST: Repository order was changed to update the draft terminal state, insert the
  match cascade, then attach `confirmed_match_id`.
- 2026-05-18 22:38 JST: Added a PostgreSQL integration regression test for successful draft
  confirmation and persisted `confirmed_match_id`.
- 2026-05-18 22:41 JST: `sbt apiCheck` passed.
- 2026-05-18 22:41 JST: `sbt apiDbQuality` passed with `PostgresMatchesRepositorySpec` executing
  the new regression test.

## Root Causes

### 1. Transaction atomicity was confused with foreign key check timing

The repository assumed that because the draft update and match insert ran in the same transaction,
it was safe to set `match_drafts.confirmed_match_id` before the referenced `matches.id` existed.

PostgreSQL's default foreign keys are not deferrable, so the reference must be valid when the
`UPDATE match_drafts` statement executes.

### 2. The successful OCR-source confirmation path was not covered against PostgreSQL

`PostgresMatchesRepositorySpec` covered direct confirmation and stale-draft refusal, but it did not
cover the successful draft-confirmation path that writes both:

```text
matches.id
match_drafts.confirmed_match_id -> matches.id
```

HTTP tests used the wired in-memory runtime, which can validate usecase behavior but cannot expose
PostgreSQL FK timing.

### 3. The test oracle did not assert the lifecycle link created by confirmation

Existing tests verified nearby behavior: duplicate match number handling and stale draft CAS
failure. They did not assert that successful confirmation from a draft leaves the source draft in
`confirmed` with the correct `confirmed_match_id`.

## Contributing Factors

- The code path tried to use one SQL update for both draft terminal-state transition and final FK
  attachment. That compressed two persistence concerns with different ordering requirements.
- The domain rule already stated the required side effect, but the repository test suite did not
  encode the exact DB-level representation of that side effect.
- `sbt test` cannot be evidence for this class of behavior because integration tests are excluded
  and in-memory repositories do not model PostgreSQL constraint timing.

## Specification And Documentation Assessment

The domain documentation was clear enough about the behavior:

```text
OCR下書きからの確定 -> matches / match_players / match_incidents を作成し、
元 match_drafts を confirmed にして confirmed_match_id を保存する
```

No domain-rule change was needed. The missing durable guidance was in the DB-backed test rule:
when a repository method writes FK-linked rows in one transaction, the PostgreSQL integration test
must execute the success path and assert the final linked row values.

## Test Architecture Assessment

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| PostgreSQL repository integration | Execute statement order, constraints, transaction behavior, and row values against PostgreSQL. | Successful draft confirmation with `confirmed_match_id` was not covered. | Add an integration test that confirms from a draft and asserts the linked draft row. |
| HTTP/API | Parse request and map errors/responses. | Not the failing layer; the request reached the repository. | No new HTTP test required unless response mapping changes. |
| Usecase/unit | Validate domain branching and draft snapshot logic. | In-memory runtime cannot model FK timing. | Keep usecase tests focused on domain branches; do not use them as DB evidence. |
| DB contract | Ensure tables/columns/FKs exist. | FK existed correctly; the bug was statement order. | No new contract test required. |

## What Worked

- The PostgreSQL error message named the exact table, column, and missing referenced key.
- The domain docs already clarified that `matchDraftId` confirmation must close the source draft.
- `apiDbQuality` executed the failing repository family and confirmed the fix with Testcontainers
  PostgreSQL.

## What Did Not Work

- Repository coverage treated stale-draft refusal as sufficient protection for the draft branch,
  but the successful branch had a distinct DB behavior.
- The previous implementation made the draft row point at a match before the match existed.
- A nearby HTTP test could not catch the issue because it used in-memory persistence.

## Immediate Remediation Completed

- Changed `PostgresMatchConfirmationRepository.confirm` so `confirmed_match_id` is attached only
  after `insertMatchCascade` creates the referenced match.
- Preserved the existing stale-draft CAS behavior: if the draft snapshot does not match, no match is
  inserted and the draft remains open.
- Added `PostgresMatchesRepositorySpec` coverage for successful draft confirmation and the persisted
  `(status = confirmed, confirmed_match_id = match.id)` row.

## Verification Performed

- `sbt apiCheck` passed.
- `sbt apiDbQuality` passed.
- `PostgresMatchesRepositorySpec` now runs 11 tests, including the new draft-confirmation FK-link
  regression.

## Residual Risk

- No production data repair was performed in this change. Based on the failure shape, the request
  should have rolled back without creating partial match rows, but any production incident response
  should verify affected draft rows separately if this occurred outside local development.
- Other repository methods may still have untested success branches involving same-transaction FK
  links. The updated test rule is intended to catch this when those methods are touched.

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Add PostgreSQL integration coverage for successful draft confirmation and persisted `confirmed_match_id`. | `apps/api/src/test/scala/momo/api/integration/PostgresMatchesRepositorySpec.scala` | The spec confirms from a draft and asserts the linked draft row. | `sbt apiDbQuality` |
| P0 | Keep a durable DB-backed test rule for same-transaction FK-linked writes. | `docs/test-rule.md` | DB-backed API rules explicitly mention FK-linked rows created/updated in one transaction. | Document review plus `sbt apiCheck` |
| P0 | Keep a short lessons prompt for PostgreSQL FK check timing. | `docs/post-mortem/lessons.md` | `lessons.md` asks future DB repository changes to consider non-deferrable FK statement order. | Document review |

## Changed Mental Model

Replace:

```text
Rows written in the same transaction can reference each other in any statement order.
```

With:

```text
Unless a constraint is explicitly deferred, PostgreSQL foreign keys must be satisfied at each
statement. A repository integration test must execute the successful branch that creates or updates
the FK-linked rows.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Repository methods that create or update FK-linked rows in one transaction need PostgreSQL integration coverage for the success path and final linked row values. | `docs/test-rule.md` |
| When touching DB-backed code, remember that non-deferrable FK constraints are checked at statement time. | `docs/post-mortem/lessons.md` |
