# Postmortem Follow-up Actions

Last reviewed: 2026-05-18

このファイルは `docs/post-mortem/*.md` から残っている follow-up action の現状だけを管理する。完了済み action の詳細履歴はここへ再掲せず、元ポストモーテムと恒久ルール文書を正とする。

## Current State

- Immediate open actions: none.
- Deferred actions: 2.
- 直近の未対応はいずれも実装漏れではなく、設計判断または E2E scope 拡大待ち。
- 新しいポストモーテムで未完了 action を追加した場合は、下の表に self-contained な形で追加し、優先度を再評価する。

## Active / Deferred Actions

| Current Priority | Status | Source | Original Priority | Action | Why not done now | Trigger to revisit | Target | Done when | Verification |
|---|---|---|---|---|---|---|---|---|---|
| P2 | Deferred | `2026-05-03-backend-matches-list-db-errors.md` | P1 | Decide dev/prod startup DB contract behavior. | API 起動時に DB contract 不一致を fail-fast にするか、起動は許して health warning に寄せるかは product / operations の設計判断。実装だけで決めると運用挙動が変わる。 | API 起動・health check・deployment readiness の方針を見直す時。DB migration 適用漏れを起動時に検知したい要求が出た時。 | API startup / health design, `docs/architecture.md`, `docs/dev-rule.md` or `docs/db-rule.md` | dev/prod それぞれで、DB contract 不一致時の起動可否と health 表示方針が文書化されている。必要なら実装タスクに分解されている。 | 方針文書レビュー。実装する場合は API 起動/health の対象テストまたは手元確認コマンドを追加して通す。 |
| P2 | Deferred | `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | P1 | Consider a broader `/matches` filter E2E when E2E smoke scope is expanded. | 直接の再発防止は `MatchesListFilters` component test と `docs/test-rule.md` の exact-operation rule で完了済み。現時点で E2E smoke を拡大するとコストと保守範囲が増える。 | `/matches` を core browser smoke flow に含める判断をした時。E2E smoke の対象をログイン後の主要一覧操作まで広げる時。 | E2E smoke suite | `/matches` の主要 filter 操作が smoke に入っている、または E2E scope 外と明示的に判断されている。少なくとも状態変更、ソート変更、開催 filter の代表操作を含めるか除外理由を残す。 | Playwright smoke。追加しない場合は E2E scope decision の文書レビュー。 |

## Completed Coverage Summary

以下のポストモーテム由来 action は完了済みとして扱う。詳細な evidence は各 source postmortem の follow-up status と、対応先の恒久ルール文書を参照する。

| Source | Current result |
|---|---|
| `2026-05-03-backend-matches-list-db-errors.md` | DB contract / PostgreSQL repository coverage / integration cleanup / DB-backed verification docs / `apiDbQuality` alias は完了。startup DB contract behavior だけが上記 Deferred。 |
| `2026-05-03-frontend-masters-query-error-visibility.md` | TanStack Query error visibility の実装ルール、テストルール、共有 helper、関連ページ audit は完了。 |
| `2026-05-03-frontend-masters-query-key-shape-collision.md` | query key が cached data shape を識別するルール、テストルール、query key audit、master mutation invalidation review は完了。 |
| `2026-05-03-frontend-matches-filter-event-currenttarget.md` | changed form/filter interaction の user-event coverage と durable test rule は完了。sort/status/season の後続分は 2026-05-04 の再発対応で補強済み。 |
| `2026-05-04-frontend-matches-sort-event-currenttarget-regression.md` | 報告された sort 操作の direct regression coverage、exact-operation rule、same-component handler pattern search rule は完了。broader `/matches` E2E だけが上記 Deferred。 |
| `2026-05-10-frontend-held-event-create-cache.md` | mutation success cache reflection の architecture rule、select/list test rule、同種 create mutation audit は完了。 |
| `2026-05-10-frontend-ocr-confirm-match-draft-id-dropped.md` | hidden workflow identifier を schema/DTO transform で落とさない test rule、lessons prompt、`matchDraftId` と `draftIds` の domain doc は完了。 |
| `2026-05-18-backend-match-confirmation-fk-order.md` | draft confirmation の PostgreSQL integration coverage、same-transaction FK-linked write の test rule、FK check timing lessons prompt は完了。 |

## Maintenance Rules

- `Status` は `Open`、`Done`、`Deferred` のいずれかにする。
- 未対応 action だけを `Active / Deferred Actions` に置く。
- `Done` にする場合は、元ポストモーテム、実装、規約、テスト、または明示的な status 記述で evidence を確認する。
- 完了済み action の個別履歴はこのファイルへ増やさず、必要なら `Completed Coverage Summary` を1行更新する。
- `Deferred` は条件付き・設計判断待ち・スコープ拡大待ちの action に使い、必ず `Trigger to revisit` を書く。
