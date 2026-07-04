# apps/web Refactor Handoff

目的: apps/web の大規模モジュール分割後に、責務境界、apps/api I/F 互換性、再発防止 guard、検証範囲を引き継げるようにする。

## I/F 互換性

- apps/api の endpoint、OpenAPI 生成物、wire value は変更していない。
- apps/web は `@/shared/api/generated` を feature から直接参照せず、`shared/api/*` facade 経由に寄せる方針を維持する。
- `pnpm --filter web lint` に含まれる `check-api-contract.mjs` で API contract 互換を確認する。

## 主な責務境界

- `features/seriesComparison`
  - `SeriesComparisonPage.tsx` は page shell。
  - `SeriesComparisonContent.tsx` と section ファイルは表示構成。
  - chart は `SeriesComparison*Chart*.tsx`、色・scale・型は小モジュールへ分離。
  - presentation は `seriesComparisonPresentation.ts` を re-export 入口にし、format / map / chart data / asset evidence / summary を分ける。
- `features/matches/workspace`
  - `useMatchWorkspaceController.ts` は query、mutation、初期化 hook の orchestration。
  - confirm、redirect、validation、source image、form handlers、view model、lifecycle effect は専用 hook。
  - `ScoreGrid.tsx` は desktop/mobile/columns/types へ分離。
  - `SourceImagePanel.tsx` は UI、`useSourceImagePanelState.ts` は preload と archive 保存状態。
- `shared/workflows/matchWorkspaceMasterHandoff.ts`
  - route/storage 操作を担当。
  - schema、payload 正規化、storage key/parse/expiry は `matchWorkspaceMasterHandoffPayload.ts`。

## React / UX 方針

- Server state は TanStack Query の cache lifecycle を維持する。React concurrent API は表示 settling、route lazy、form action 境界に限定する。
- Series comparison は `useTransition`、`useDeferredValue`、placeholder data、stale shield を使い、条件変更時に既存表示を急に空にしない。
- Match workspace は `useActionState` を confirm submit 境界に限定し、フォーム値から API request への workflow identifier を落とさない。
- route は `React.lazy` と route-specific Suspense skeleton を継続利用する。

## Guard

- `apps/web/scripts/check-module-size.mjs`
  - production TS/TSX module が 300 行を超えると失敗する。
  - `src/test`, `*.test.*`, `generated.ts` は対象外。
- `pnpm --filter web lint`
  - oxlint
  - architecture import guard
  - API contract guard
  - module size guard

## 検証

今回の refactor で通す最低ライン:

```sh
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:run
pnpm --filter web build
```

UI 表示や操作経路を変える追加改修を行う場合は、対象画面の Testing Library test または E2E smoke を追加する。
