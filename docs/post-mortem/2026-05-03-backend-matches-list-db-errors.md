# Postmortem: GET /api/matches backend DB errors

Date: 2026-05-03

Scope: backend only (`apps/api`, PostgreSQL schema managed by `../momo-db`)

Status: mitigated locally. Recurrence prevention is not complete until the P0 actions in this
document are implemented.

## Summary

`GET /api/matches` failed during local verification with two backend DB errors:

1. `relation "match_drafts" does not exist`
2. `invalid UNION/INTERSECT/EXCEPT ORDER BY clause`

The first error was caused by running the API against a local database where the `momo-db`
migrations that create momo-result match tables had not been applied.

The second error was a PostgreSQL runtime SQL error in `PostgresMatchListRepository`. The repository
used `ORDER BY COALESCE(...)` directly after a `UNION ALL`; PostgreSQL only allows result column names
in the top-level `ORDER BY` of a set operation. The query was fixed by wrapping the union in a
derived table and ordering the derived result.

The important systemic issue is not only these two bugs. The verification model treated "related
backend tests passed" as enough confidence even though the exact failing repository/query was not
executed against PostgreSQL.

## Impact

- `GET /api/matches` returned 500.
- Frontend flows depending on the matches list could not reliably load data.
- HikariCP marked a connection as broken after PostgreSQL SQLSTATE `0A000`.
- No data loss was observed.

## Timeline

All times are shown with their original source timezone.

- 2026-05-03 00:39 UTC: `GET /api/matches` failed with
  `relation "match_drafts" does not exist`.
- 2026-05-03 09:41 JST: Local `../momo-db` migrations were applied with
  `pnpm --dir ../momo-db db:migrate`.
- 2026-05-03 09:41 JST: Local existence of `match_drafts`, `matches`, `match_players`, and
  `match_incidents` was confirmed.
- 2026-05-03 00:42 UTC: `GET /api/matches` then failed with
  `invalid UNION/INTERSECT/EXCEPT ORDER BY clause`.
- 2026-05-03 09:44 JST: `PostgresMatchListRepository` was changed to wrap the `UNION ALL` query in
  `SELECT * FROM (...) AS combined`.
- 2026-05-03 09:44 JST: `sbt "testOnly momo.api.integration.PostgresMatchesRepositorySpec"` passed.
  This confirmed nearby DB functionality, but did not directly execute the failing repository.

## Root Causes

### 1. Migration state was assumed instead of verified

`momo-result` does not own DB migrations. The canonical schema lives in `../momo-db`, as documented
in `docs/db-rule.md`.

The API was run against `postgres://summit:summit@localhost:5433/summit`, but that DB did not yet
have the migrations that create momo-result tables such as `match_drafts`.

The missing practice was: before verifying a PostgreSQL-backed API path, explicitly verify that the
consumer API's DB contract exists in the target database.

### 2. A SQL runtime property was treated as if compile success could cover it

The match list repository builds a union of confirmed matches and active match drafts. The original
query shape was equivalent to:

```sql
SELECT ...
FROM matches
UNION ALL
SELECT ...
FROM match_drafts
ORDER BY COALESCE(played_at, updated_at) DESC;
```

PostgreSQL rejects expressions in a top-level `ORDER BY` after `UNION`/`INTERSECT`/`EXCEPT`. The
correct shape is:

```sql
SELECT *
FROM (
  SELECT ...
  FROM matches
  UNION ALL
  SELECT ...
  FROM match_drafts
) AS combined
ORDER BY COALESCE(combined.played_at, combined.updated_at) DESC;
```

Doobie typechecking and Scala compilation cannot detect this class of SQL runtime error. The query
must be executed against PostgreSQL.

### 3. Test confidence came from the wrong execution unit

`PostgresMatchesRepositorySpec` exercises confirmed match persistence. It does not execute the
`PostgresMatchListRepository` query used by `GET /api/matches`.

The incorrect mental model was:

```text
Related repository spec passed -> DB-backed matches endpoint is probably covered
```

The required mental model is:

```text
The repository/query behind the endpoint was executed against PostgreSQL -> this DB path is covered
```

## Contributing Factors

- `DbContractSpec` checks some DB assumptions, but did not assert the existence of `match_drafts`,
  `match_players`, `match_incidents`, or key columns used by the match list query.
- `IntegrationDb.truncateAppTables` did not include `match_drafts`, which would make future
  draft/list integration tests susceptible to state leakage.
- Local integration suites skip when PostgreSQL is unavailable. This is useful for regular local
  development, but skipped DB tests cannot be used as evidence that DB behavior was verified.
- The API consumes a schema owned by another repo. This makes migration state a release prerequisite,
  not an implementation detail.

## Test Architecture Assessment

The appropriate fix is not a single regression test. The failure crosses two different test
responsibilities: DB contract availability and repository SQL behavior. These should remain separate.

| Layer | Responsibility | Should catch | Should not own |
|---|---|---|---|
| `DbContractSpec` | Verify the database exposes the tables, columns, and seed data the API assumes. | Missing `match_drafts`; missing columns; missing required seed rows. | Repository ordering, filters, response mapping. |
| `Postgres*RepositorySpec` | Execute repository SQL against real PostgreSQL. | Invalid SQL; wrong filters; wrong ordering; transaction behavior. | HTTP parsing, auth, response status mapping. |
| HTTP specs | Verify route-level behavior. | Request parameters, auth/CSRF boundaries, response encoding, AppError mapping. | Full SQL coverage for every repository branch. |
| Usecase/in-memory tests | Verify domain branching without DB cost. | Status/kind parsing, validation, AppError decisions. | PostgreSQL syntax, schema contract, migration state. |

Current gap:

- The contract layer did not prove the match-list tables existed.
- The repository layer did not execute `PostgresMatchListRepository.list`.
- The HTTP/usecase layers could not compensate for that because they either use in-memory adapters or
  do not cover PostgreSQL-specific SQL execution.

Architectural principle:

```text
Every DB-backed endpoint needs at least one test that executes its PostgreSQL repository path.
Every table/column assumed by API SQL needs a DB contract assertion.
```

## What Worked

- PostgreSQL logs included precise error messages and positions.
- `docs/db-rule.md` correctly points agents to `../momo-db` as the migration source.
- Applying `momo-db` migrations fixed the missing relation without API code changes.
- Wrapping the `UNION ALL` in a derived table fixed the SQL semantics issue without changing the API
  response contract.

## What Did Not Work

- Verification did not start from migration/contract checks.
- A nearby integration test was used as evidence even though it did not execute the failing query.
- The test architecture did not yet contain a direct match-list repository integration spec.
- The remediation report initially risked becoming a checklist instead of a durable test-system
  change.

## Immediate Remediation Completed

- Applied local migrations:

```sh
pnpm --dir ../momo-db db:migrate
```

- Confirmed local existence of:
  `match_drafts`, `matches`, `match_players`, `match_incidents`
- Fixed `PostgresMatchListRepository` to use:

```sql
SELECT *
FROM (...) AS combined
ORDER BY COALESCE(combined.played_at, combined.updated_at) DESC,
         combined.updated_at DESC,
         combined.created_at DESC
```

## Residual Risk

The SQL fix is locally mitigated, but recurrence prevention is incomplete until:

- `PostgresMatchListRepository.list` is directly covered by a PostgreSQL integration test.
- `DbContractSpec` fails when the match-list tables/columns are missing.
- Integration cleanup includes `match_drafts` so future tests do not depend on execution order.
- Verification reports distinguish "DB tests skipped" from "DB behavior verified".

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Add `PostgresMatchListRepositorySpec`. | `apps/api/src/test/scala/momo/api/integration/` | Tests execute `PostgresMatchListRepository.list` for `kind=all,status=all` and cover confirmed + active draft union. | `sbt "testOnly momo.api.integration.PostgresMatchListRepositorySpec"` |
| P0 | Extend DB contract coverage for match-list dependencies. | `DbContractSpec` | Missing `match_drafts`, `matches`, `match_players`, `match_incidents`, or required columns fails the suite. | `sbt "testOnly momo.api.integration.DbContractSpec"` |
| P0 | Add `match_drafts` to integration cleanup. | `IntegrationDb.truncateAppTables` | Draft/list integration tests can run repeatedly without leaked draft rows. | Run draft/list repository specs twice in one sbt invocation. |
| P1 | Document DB-backed backend verification commands. | `docs/test-rule.md` or `docs/dev-rule.md` | The required command sequence is discoverable without reading this postmortem. | A future AI report names the exact DB-backed test it ran. |
| P1 | Add an sbt alias for DB-backed verification. | `apps/api/build.sbt` | Agents can run one named command for DB contract + Postgres repository specs. | `sbt <alias>` runs the intended suites. |
| P1 | Decide dev/prod startup DB contract behavior. | API startup / health design | A documented decision exists for fail-fast vs health warning. | Decision recorded before implementation. |

## Regression Cases For `PostgresMatchListRepositorySpec`

Minimum cases:

- Empty DB returns an empty list for the default filter.
- `kind=match,status=confirmed` returns confirmed matches and loads ranks.
- `kind=match_draft,status=all` returns active drafts and excludes `cancelled` / `confirmed`.
- `kind=all,status=all` unions confirmed matches and active drafts without PostgreSQL error.
- Ordering uses `COALESCE(played_at, updated_at) DESC`, then `updated_at DESC`, then
  `created_at DESC`.
- `limit` applies after union and ordering.

The `kind=all,status=all` case is mandatory because it executes the exact query shape that failed.

## AI Work Rules For PostgreSQL-backed API Work

These rules are intended to be embedded into future AI execution, not treated as optional advice.

1. Identify the endpoint, usecase, repository, and exact method under verification.
2. If SQL references `../momo-db` tables, run or confirm migrations before debugging API code:

```sh
pnpm --dir ../momo-db db:migrate
```

3. Run `DbContractSpec` when a failure mentions missing tables/columns or when a repository starts
   using new DB objects.
4. Run or add a `Postgres*RepositorySpec` that executes the same repository method used by the
   endpoint.
5. Treat SQL using `UNION`, `INTERSECT`, `EXCEPT`, `DISTINCT`, window functions, JSON operators, or
   dynamic fragments as requiring live PostgreSQL execution.
6. Do not claim DB behavior was verified if the relevant integration suite skipped because
   PostgreSQL was unavailable.
7. Do not use a nearby repository spec as evidence for a different repository/query.

## Changed Mental Model

Replace these assumptions:

```text
Scala compiled -> SQL is valid enough
Related DB spec passed -> endpoint DB path is probably covered
Migration lives in another repo -> migration state is someone else's concern
Skipped integration tests -> acceptable verification in a DB incident
```

With these:

```text
SQL correctness is established only after the relevant query executes on PostgreSQL
The tested unit must match the failing repository or endpoint path
Cross-repo migration state is a consumer-side precondition that must be verified
Skipped DB tests mean DB behavior remains unverified
```

## Prevention Rule

For backend work touching PostgreSQL, the minimum acceptable verification is:

```sh
pnpm --dir ../momo-db db:migrate
cd apps/api
sbt "testOnly <DbContractSpec and the PostgreSQL repository spec that directly exercises the changed path>"
```

If the direct repository spec does not exist, adding it is part of the task. A compile check or a
nearby repository spec is not enough to close a SQL runtime incident.
