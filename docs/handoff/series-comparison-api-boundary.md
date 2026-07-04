# Series Comparison API Boundary Handoff

Created: 2026-07-04

## Scope

`apps/web` のリファクタリング第2弾で、戦績比較ページの web 側 presentation / summary / threshold logic が `apps/api` 所有へ移るべきかを確認した。

今回の実装では `apps/api` の endpoint、DTO、OpenAPI 生成物は変更していない。`apps/api` は集計、drilldown、review、playbook scoring をすでに所有しており、`apps/web` 側の変更は UI contract と presentation boundary の整理に留めた。

## Current Boundary

`apps/api` 所有:

- 戦績比較の集計結果
- drilldown の rank / play order history
- review / playbook の候補生成、score、data reason、advice text
- `profileKind`、`strategyKind`、`assetStyle` などの semantic code

`apps/web` に残してよいもの:

- API が返した semantic code の日本語 label
- chart / table / card 用の表示順、表示色、短い status label
- URL state、tab state、loading / stale shield などの UI state

## API Migration Candidates

以下は現在 web に残っているが、複数画面で再利用する、CSV/TSV/API 出力に載せる、または業務上の判定規則として安定させる場合は `apps/api` 側の read model に移す。

- `averageRankSpread` の `flat/small/visible/large` 判定
- head-to-head の advantage / disadvantage 判定
- momentum switch の OK / warning 判定
- sample maturity 閾値

移行する場合は、web が閾値を再計算しないように、API response に以下のような semantic field を追加する。

- `rankSpreadSignal`
- `headToHeadSignal`
- `momentumSwitchSignal`
- `sampleMaturity`

## Required Follow-up Gate

API DTO を変更する場合:

- `apps/api/openapi.yaml` を更新する
- `apps/web/src/shared/api/generated.ts` を更新する
- `sbt apiQuality`
- `sbt test`
- `pnpm --filter web generate:api`
- `pnpm --filter web lint`
- `pnpm --filter web typecheck`
- `pnpm --filter web test:run`
- UI flow が変わる場合は `pnpm --filter web e2e`

## Current Decision

今回は API 互換性を維持する。web 側の閾値は現時点では表示強調のための local presentation rule として扱い、API の外部契約には昇格しない。

ただし、上記の判定が product-wide semantic になる場合は、この文書を起点に API read model へ移す。
