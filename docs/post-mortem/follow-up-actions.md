# Postmortem Follow-up Actions

Last reviewed: 2026-05-10

このファイルは `docs/post-mortem/*.md` の `Follow-up Actions` を横断して、対応状況と優先度を管理するための一覧である。新しいポストモーテムで follow-up action を追加した場合は、このファイルにも同じ action を追加し、未対応 action 全体の優先度を再評価して並べ直す。

## 管理方針

- Source は元ポストモーテムを指す。
- Status は `Open`、`Done`、`Deferred` のいずれかにする。
- 未対応 action はこのファイルの `Open / Deferred Actions` で優先度順に並べる。
- `Done` にする場合は、確認した実装・規約・テスト・明示的な status 記述のいずれかを Evidence に残す。
- `Deferred` は条件付き・設計判断待ち・スコープ拡大待ちの action に使う。

## Open / Deferred Actions

| Current Priority | Status | Source | Original Priority | Action | Target | Done when | Verification | Evidence / Note |
|---|---|---|---|---|---|---|---|---|
| P1 | Open | `2026-05-10-frontend-held-event-create-cache.md` | P1 | Audit other frontend create mutations that immediately select or display the created resource. | `apps/web/src/features/**` | Each such mutation either updates the relevant cache, invalidates and waits/refetches appropriately, or documents why no same-page reflection is needed. | `rg "useMutation|setQueryData|invalidateQueries" apps/web/src/features apps/web/src/shared` plus targeted tests for any changed flow. | No postmortem status or audit result found yet. Current architecture/test rules are in place, but this specific audit remains separate work. |
| P2 | Deferred | `2026-05-03-backend-matches-list-db-errors.md` | P1 | Decide dev/prod startup DB contract behavior. | API startup / health design | A documented decision exists for fail-fast vs health warning. | Decision recorded before implementation. | Original postmortem marks this as not completed and a product/operations design decision. Existing `docs/architecture.md` separates `/healthz` and detailed dependency health, but no explicit startup DB contract decision was found. |
| P2 | Deferred | `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | P1 | Consider a broader `/matches` filter E2E when E2E smoke scope is expanded. | E2E smoke suite | 状態変更、ソート変更、開催 filter のうち主要操作が1本の smoke に入っている。 | Playwright smoke | Original postmortem marks this as conditional on E2E smoke scope expansion, not an immediate follow-up. |

## Completed Actions

| Completed Date | Source | Original Priority | Action | Target | Verification | Evidence |
|---|---|---|---|---|---|---|
| 2026-05-04 | `2026-05-03-backend-matches-list-db-errors.md` | P0 | Add `PostgresMatchListRepositorySpec`. | `apps/api/src/test/scala/momo/api/integration/` | `sbt "testOnly momo.api.integration.PostgresMatchListRepositorySpec"` | Source postmortem status says completed. `apps/api/build.sbt` includes `apiDbQuality`; DB-backed rules are documented in `docs/test-rule.md` / `docs/dev-rule.md`. |
| 2026-05-04 | `2026-05-03-backend-matches-list-db-errors.md` | P0 | Extend DB contract coverage for match-list dependencies. | `DbContractSpec` | `sbt "testOnly momo.api.integration.DbContractSpec"` | Source postmortem status says completed. `DbContractSpec` contains `match_drafts` coverage and DB contract rules point to `apiDbQuality`. |
| 2026-05-04 | `2026-05-03-backend-matches-list-db-errors.md` | P0 | Add `match_drafts` to integration cleanup. | `IntegrationDb.truncateAppTables` | Run draft/list repository specs twice in one sbt invocation. | Source postmortem status says completed. `IntegrationDb.truncateAppTables` includes `match_drafts`. |
| 2026-05-04 | `2026-05-03-backend-matches-list-db-errors.md` | P1 | Document DB-backed backend verification commands. | `docs/test-rule.md` or `docs/dev-rule.md` | A future AI report names the exact DB-backed test it ran. | Source postmortem status says completed. `docs/test-rule.md` and `docs/dev-rule.md` document `apiDbQuality`. |
| 2026-05-04 | `2026-05-03-backend-matches-list-db-errors.md` | P1 | Add an sbt alias for DB-backed verification. | `apps/api/build.sbt` | `sbt <alias>` runs the intended suites. | Source postmortem status says completed. `apps/api/build.sbt` defines `apiDbQuality`. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-error-visibility.md` | P0 | Keep a durable rule for TanStack Query load-error tests. | `docs/test-rule.md` | A future frontend error-display change names the relevant cache/refetch test or explains why it is not applicable. | Source postmortem status says completed. `docs/test-rule.md` includes cached-error/remount/refetch guidance. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-error-visibility.md` | P0 | Keep an implementation rule for TanStack Query error visibility. | `docs/architecture.md` | Review of a query error UI can point to the architecture rule. | Source postmortem status says completed. `docs/architecture.md` states `query.error` / `isError` alone is insufficient. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-error-visibility.md` | P1 | Audit other query-driven pages for stale error visibility. | `apps/web/src/features/**` | `rg "isError|query.error|読み込みに失敗" apps/web/src/features` plus targeted Vitest updates where needed. | Source postmortem status says completed. Shared `queryErrorState` helpers are used by query-driven pages. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-error-visibility.md` | P1 | Promote a shared helper if two or more pages need identical blocking-load semantics. | `apps/web/src/shared` or feature-local shared module | `pnpm --dir apps/web test:run <affected tests>` | Source postmortem status says completed. `apps/web/src/shared/api/queryErrorState.ts` owns shared helpers. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-key-shape-collision.md` | P0 | Keep a durable rule that a TanStack Query key must identify the cached data shape, not only the backend resource. | `docs/architecture.md` | Reviewers can reject a query key that stores incompatible shapes under the same identity. | Source postmortem status says completed. `docs/architecture.md` documents runtime data shape ownership for query keys. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-key-shape-collision.md` | P0 | Keep a test rule for pages using shared resources with feature-local transformations. | `docs/test-rule.md` | A future query-key change includes a direct cache-shape regression test or explains why no cross-page cache exists. | Source postmortem status says completed. `docs/test-rule.md` requires conflicting cache shape coverage when applicable. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-key-shape-collision.md` | P1 | Audit frontend query keys for raw-response versus transformed-array collisions. | `apps/web/src/features/**`, `apps/web/src/shared/api/**` | `rg "queryKey:" apps/web/src` plus targeted tests for any changed keys. | Source postmortem status says completed. |
| 2026-05-04 | `2026-05-03-frontend-masters-query-key-shape-collision.md` | P1 | Review master mutation invalidation after key separation. | `apps/web/src/features/masters/MastersPage.tsx` | Add/adjust tests if immediate cross-route freshness is required. | Source postmortem status says completed. `MastersPage.tsx` invalidates admin and consumer-facing master cache namespaces; `MastersPage.test.tsx` covers game title creation invalidation. |
| 2026-05-04 | `2026-05-03-frontend-matches-filter-event-currenttarget.md` | P0 | Keep regression coverage for at least one changed matches filter select. | `apps/web/src/features/matches/MatchesPages.test.tsx` | `pnpm --dir apps/web test:run -- MatchesPages` | Source postmortem status says completed. `MatchesPages.test.tsx` covers filter/sort URL behavior. |
| 2026-05-04 | `2026-05-03-frontend-matches-filter-event-currenttarget.md` | P0 | Keep durable test rule for changed form/filter interactions. | `docs/test-rule.md` | 文書レビュー | Source postmortem status says completed. `docs/test-rule.md` requires user-event coverage for changed form/filter controls. |
| 2026-05-04 | `2026-05-03-frontend-matches-filter-event-currenttarget.md` | P1 | Add broader filter behavior tests when sort/status/season behavior changes again. | `apps/web/src/features/matches/list` | 対象変更時の Vitest | Source postmortem says completed for the sort change. Direct sort interaction and URL parameter coverage now exist. |
| 2026-05-04 | `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | P0 | Keep direct regression coverage for the reported sort interaction. | `apps/web/src/features/matches/list/__tests__/MatchesListFilters.test.tsx` | `pnpm --filter web test:run -- MatchesListFilters` | Source postmortem status says completed. `MatchesListFilters.test.tsx` covers `updated_desc` selection and `onApply`. |
| 2026-05-04 | `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | P0 | Require exact failing UI operation coverage during form/filter bug fixes. | `docs/test-rule.md` | 文書レビュー | Source postmortem status says completed. `docs/test-rule.md` requires testing the reported operation itself. |
| 2026-05-04 | `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | P0 | Require same-component handler pattern search during event lifetime fixes. | `docs/test-rule.md` | 文書レビュー | Source postmortem status says completed. `docs/test-rule.md` requires same-component handler pattern search. |
| 2026-05-10 | `2026-05-10-frontend-held-event-create-cache.md` | P0 | Keep a durable architecture rule that create/update mutations must refresh or patch any query cache that powers the currently selected candidate list. | `docs/architecture.md` | Reviewers can point to the rule when a mutation sets a selected ID. | `docs/architecture.md` documents mutation success cache reflection for selected/displayed resources. |
| 2026-05-10 | `2026-05-10-frontend-held-event-create-cache.md` | P0 | Keep a durable test rule for mutation-driven selects/lists. | `docs/test-rule.md` | A future fix includes a direct user-event test or explains why no visible candidate list exists. | `docs/test-rule.md` requires asserting selected value and option/list membership. `DraftReviewPage.test.tsx` covers the exact held-event create interaction. |

## Review Notes

- 現在の未対応で最も具体的なのは、2026-05-10 の create mutation audit である。既存の durable rules は入っているが、横断監査の完了証跡はない。
- backend startup DB contract behavior は実装作業ではなく設計判断待ちとして扱う。
- `/matches` filter E2E は E2E smoke scope 拡大時の候補であり、直近の component/page 回帰対策は完了済み。
