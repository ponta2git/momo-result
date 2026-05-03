# Postmortem: Matches filter event currentTarget crash

Date: 2026-05-03

Scope: frontend only (`apps/web/src/features/matches/list`)

Status: resolved. Follow-up rule updates completed.

## Summary

`/matches` の開催 filter select を変更すると、画面が `Unexpected Application Error!` で落ちた。
直接原因は `MatchesListFilters` の `onChange` が `setDraftSearch((current) => ...)` の updater 内で
`event.currentTarget.value` を読んでいたことだった。React のイベントオブジェクトは handler を抜けた後に
`currentTarget` が `null` になるため、state updater 実行時に `can't access property "value",
event.currentTarget is null` が発生した。

修正では、各 `onChange` handler の先頭で `const value = event.currentTarget.value` として値を退避し、
state updater 内では退避済みの `value` だけを使うようにした。

## Impact

- `/matches` で開催日 filter を選択したユーザーが画面全体のアプリケーションエラーを見る。
- 絞り込みを適用する前の入力段階で落ちるため、一覧ホームとしての基本操作が中断される。
- データ破損、永続データ変更、サーバー影響は確認されていない。

## Timeline

- 2026-05-03: `/matches` を `features/matches/list/` へ分割し、filter UI を刷新した。
- 2026-05-03: `format:check` / `lint` / `typecheck` / `test:run` は通ったが、開催 select の変更操作はテストで実行されていなかった。
- 2026-05-03: ユーザーが開催日選択時の `event.currentTarget is null` エラーを報告した。
- 2026-05-03: `MatchesListFilters` の select `onChange` で値を handler 内に退避する修正を実施した。
- 2026-05-03: `MatchesPages.test.tsx` に開催 filter select の user-event 回帰テストを追加した。

## Root Causes

### 1. React event value was read inside a deferred state updater

`setDraftSearch((current) => ...)` の updater は handler 本体の同期実行とは別タイミングで評価される。
その中で `event.currentTarget.value` を参照したため、React が `currentTarget` を `null` にした後の
event を読んでしまった。

正しいモデルは次の通り。

```text
Event-derived values must be copied inside the event handler before passing data into a state updater.
```

### 2. The verification focused on render and data mapping, not changed user interactions

既存の `MatchesListPage` テストは heading と詳細リンクの表示を確認していたが、filter select を実際に
操作していなかった。ViewModel と URL parse/serialize の unit test も、DOM event の寿命とは無関係な層である。

### 3. PC/mobile duplicated controls increased the chance of pattern duplication

`MatchesListFilters` は desktop 用 select と mobile details 内 select を別々に持っている。同じ handler
パターンを複数箇所へ書いたため、1箇所だけでなく開催・作品・シーズンの両表示系に同じリスクが広がった。

## Contributing Factors

- TypeScript は `event.currentTarget.value` の型を検証できるが、React event の実行タイミングまでは検証しない。
- `lint` は既存警告を出していたが、この event lifetime の問題は検出していなかった。
- filter UI の受け入れ条件に「状態フィルタで表示が切り替わる」はあったが、開催/作品/シーズン select の代表操作を実行するテストが不足していた。

## Test Architecture Assessment

この問題は frontend component/page 層で捕まえるべきだった。API、ViewModel、URL parser のテストでは、
React DOM event と state updater の実行順序を再現できない。

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web component/page | UI表示、フォーム操作、イベントハンドラ、ユーザー操作後の画面維持。 | select を表示するだけで、開催日選択の `onChange` 実行経路を通していなかった。 | Testing Library + user-event で代表 filter select を変更する。 |
| ViewModel/unit | API DTOから表示用モデルへの変換、sort、summary。 | DOM event lifetime は対象外。 | 追加不要。 |
| E2E smoke | ログイン後の主要フローをブラウザで確認。 | 主要 filter 操作が smoke に入れば捕まる可能性はあるが、コストが高い。 | component/page test を主対策にし、E2E は後続で主要フロー化する場合に追加する。 |

追加した回帰テストは `/matches` を描画し、開催 select の option が読み込まれた後に
`userEvent.selectOptions(..., "held-1")` と `絞り込む` を実行する。修正前の実装なら、この操作で同じ
`currentTarget is null` の失敗に到達する。

## What Worked

- ユーザーからのスタックトレースに `MatchesListFilters/onChange` と該当行が含まれており、原因箇所をすぐ特定できた。
- state updater に渡す値を handler 内で退避するだけで、影響範囲を filter component に閉じて修正できた。
- `format:check` / `typecheck` / `test:run -- MatchesPages` で修正後の基本品質を確認できた。

## What Did Not Work

- 初回実装時のテストが「一覧が表示される」確認に寄り、filter の代表操作を通していなかった。
- 同じ `event.currentTarget.value` 参照パターンが desktop/mobile の複数 select に重複した。
- 完了報告時に 360px/1200px の表示観点は反芻したが、入力操作の実行経路を十分に反芻できていなかった。

## Immediate Remediation Completed

- `MatchesListFilters` の開催・作品・シーズン select で、`event.currentTarget.value` を handler 内の `value` に退避するよう修正した。
- `MatchesPages.test.tsx` に開催 filter select の user-event 回帰テストを追加した。
- `docs/test-rule.md` に form/filter/select/input の変更時は代表操作を user-event で通すルールを追加した。
- `docs/post-mortem/lessons.md` に frontend form interaction の反芻ポイントを追加した。

## Verification Performed

- `pnpm --dir apps/web format:check`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test:run -- MatchesPages`

## Residual Risk

- 作品 select、シーズン select、mobile details 内 select は同じ修正パターンを適用済みだが、追加テストは開催 select の代表操作に絞った。
- `/matches` の filter 全体を実ブラウザで横断する E2E smoke はまだない。主要フローを E2E 化する時に候補に入れる。

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep regression coverage for at least one changed matches filter select. | `apps/web/src/features/matches/MatchesPages.test.tsx` | 開催 select を user-event で変更するテストが存在する。 | `pnpm --dir apps/web test:run -- MatchesPages` |
| P0 | Keep durable test rule for changed form/filter interactions. | `docs/test-rule.md` | form/filter/select/input 変更時に user-event の代表操作が必要と明記されている。 | 文書レビュー |
| P1 | Add broader filter behavior tests when sort/status/season behavior changes again. | `apps/web/src/features/matches/list` | 変更した filter ごとに URL 反映または表示更新を検証する。 | 対象変更時の Vitest |

## Changed Mental Model

Replace:

```text
If a form renders and TypeScript passes, simple onChange state updates are covered enough.
```

With:

```text
Changed form controls need at least one user-event test that executes the handler path, and event-derived values must be copied before entering state updater functions.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Changed form/filter/select/input controls need representative user-event coverage. | `docs/test-rule.md` |
| Event-derived values must be copied in the handler before state updater functions use them. | `docs/test-rule.md` |
| Keep a short reflection prompt for frontend form interaction changes. | `docs/post-mortem/lessons.md` |
