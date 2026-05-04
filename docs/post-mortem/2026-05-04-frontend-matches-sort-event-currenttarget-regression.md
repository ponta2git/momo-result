# Postmortem: Matches sort event currentTarget regression

Date: 2026-05-04

Scope: frontend only (`apps/web/src/features/matches/list`)

Status: resolved. Follow-up rule updates completed.

## Summary

`/matches` のソート select で「更新が新しい順」を選ぶと、画面が `Unexpected Application Error!` で落ちた。
直接原因は `MatchesListFilters` のソート `onChange` が `setDraftSearch((current) => ...)` の updater 内で
`event.currentTarget.value` を読んでいたことだった。React の handler を抜けた後に `currentTarget` が
`null` になり、updater 実行時に `can't access property "value", event.currentTarget is null` が発生した。

これは 2026-05-03 の `MatchesListFilters` filter select 修正と同じ不具合クラスだったが、前回の修正と
回帰テストが開催 filter 経路に偏り、ソート select 経路が漏れていた。

## Impact

- `/matches` でソート条件を変更したユーザーが画面全体のアプリケーションエラーを見る。
- 絞り込み適用前の入力段階で落ちるため、試合一覧の並び替え操作が中断される。
- データ破損、永続データ変更、サーバー影響は確認されていない。

## Timeline

- 2026-05-03: 開催 filter select で同じ `event.currentTarget is null` 系の障害が発生し、開催・作品・シーズン select を修正した。
- 2026-05-03: `MatchesPages.test.tsx` に開催 filter select の user-event 回帰テストを追加した。
- 2026-05-04 11:44 JST: ユーザーがソート基準変更時の `event.currentTarget is null` エラーを報告した。
- 2026-05-04 11:45 JST: ソート `onChange` で `event.currentTarget.value` を handler 内の `value` に退避する修正を実施した。
- 2026-05-04 11:45 JST: `MatchesListFilters.test.tsx` にソート select の user-event 回帰テストを追加した。

## Root Causes

### 1. The same React event lifetime bug remained in a neighboring control

ソート select だけが、前回修正後も `event.currentTarget.value` を state updater 内で参照していた。
`setDraftSearch((current) => ...)` の updater は handler 本体とは別タイミングで評価され得るため、
event 由来の値は handler 内で同期的にコピーしてから updater に渡す必要がある。

### 2. The previous regression test covered a similar path, not the exact failing path

開催 filter select の user-event テストは、開催 select の `onChange` だけを実行していた。ソート select は
同じ component 内の別 handler であり、開催 select のテストではソート `onChange` の event lifetime 問題を
検出できなかった。

### 3. The remediation mental model stopped at "representative operation"

前回の durable rule は「代表操作を user-event で通す」だった。今回のような障害対応では、代表操作だけでなく、
報告された操作そのものを通すテストと、同一 component 内の同種 handler パターン探索が必要だった。

## Contributing Factors

- `MatchesListFilters` には状態、ソート、開催、作品、シーズンの複数の filter control があり、同じ state を更新する handler が分散していた。
- 前回の postmortem は `MatchesListFilters` の form interaction リスクを捉えていたが、修正範囲の完全性確認が不足していた。
- TypeScript、format、lint は React event の lifetime と state updater の評価タイミングを検出しない。

## Test Architecture Assessment

この問題は frontend component/page 層で捕まえるべきだった。URL serializer、ViewModel、API のテストでは、
React DOM event と state updater の実行順序を再現できない。

| Layer | Responsibility | Current gap | Needed change |
|---|---|---|---|
| web component/page | UI state、form/filter 操作、イベントハンドラの実行経路。 | 開催 filter の代表操作はあったが、報告されたソート select の `onChange` は未実行だった。 | `MatchesListFilters` 単体でソート select を user-event で変更し、適用値を確認する。 |
| ViewModel/unit | sort 実行結果、summary、DTO 変換。 | DOM event lifetime は対象外。 | 追加不要。 |
| E2E smoke | ログイン後の主要 UI flow。 | 実ブラウザなら捕まる可能性はあるが、今回の最小再発防止には重い。 | component test を主対策にし、E2E は一覧主要フロー化時に検討する。 |

追加した回帰テストは `MatchesListFilters` を直接描画し、`userEvent.selectOptions(screen.getByLabelText("ソート"), "updated_desc")`
と `絞り込む` を実行する。修正前の実装なら、この操作で同じ `currentTarget is null` の失敗に到達する。

## What Worked

- ユーザーのスタックトレースに `MatchesListFilters/onChange` と該当操作が含まれ、原因を絞り込めた。
- 値を handler 内で退避する修正だけで、影響範囲を一覧 filter component に閉じられた。
- 同種検索により、残る `event.currentTarget.value` は handler 内の即時読み取りまたは単純転送であることを確認できた。

## What Did Not Work

- 前回の開催 filter 回帰テストを、ソート select の安全性確認の代替として扱ってしまえる余地が残っていた。
- postmortem の follow-up が「代表操作」中心で、障害対応時の「報告操作そのもの」と「同種パターン探索」まで明確ではなかった。
- 同一 component 内の filter control 一覧を、障害修正時のチェックリストとして扱えていなかった。

## Immediate Remediation Completed

- `MatchesListFilters` のソート `onChange` で、`event.currentTarget.value` を handler 内の `value` に退避するよう修正した。
- `MatchesListFilters.test.tsx` を追加し、ソート select の変更と適用を user-event で検証した。
- `docs/test-rule.md` に、障害対応では報告された操作そのものを user-event で通すこと、同一 component 内の同種 handler を確認することを追加した。
- `docs/post-mortem/lessons.md` の frontend form interaction prompt を更新し、この再発事象へリンクした。

## Verification Performed

- `pnpm --filter web test:run -- MatchesListFilters MatchesPages`
- `pnpm --filter web typecheck`
- `pnpm --filter web lint`
- `pnpm --filter web format:check`

## Residual Risk

- `/matches` の全 filter 組み合わせを実ブラウザで横断する E2E smoke はまだない。
- 今回追加した component test はソートの event 経路を直接検証するが、URL 反映後の一覧表示順までは `MatchesListPage` 側と ViewModel 側の既存テストに分かれている。

## Follow-up Actions

| Priority | Action | Target | Done when | Verification |
|---|---|---|---|---|
| P0 | Keep direct regression coverage for the reported sort interaction. | `apps/web/src/features/matches/list/__tests__/MatchesListFilters.test.tsx` | ソート select を `updated_desc` に変更し、`onApply` が同じ sort を受け取る。 | `pnpm --filter web test:run -- MatchesListFilters` |
| P0 | Require exact failing UI operation coverage during form/filter bug fixes. | `docs/test-rule.md` | 障害対応時は代表操作ではなく報告された操作そのものを user-event で通す、と明記されている。 | 文書レビュー |
| P0 | Require same-component handler pattern search during event lifetime fixes. | `docs/test-rule.md` | 同一 component 内の同種 event/state updater pattern を確認する、と明記されている。 | 文書レビュー |
| P1 | Consider a broader `/matches` filter E2E when E2E smoke scope is expanded. | E2E smoke suite | 状態変更、ソート変更、開催 filter のうち主要操作が1本の smoke に入っている。 | Playwright smoke |

## Changed Mental Model

Replace:

```text
A representative select interaction is enough to prove nearby filter controls are safe.
```

With:

```text
For a UI interaction bug, test the exact reported control and search the whole component for the same event/state updater pattern.
```

## Rules Moved

| Lesson | Durable home |
|---|---|
| Bug fixes for form/filter interactions need user-event coverage of the exact reported operation. | `docs/test-rule.md` |
| Event lifetime fixes require same-component search for equivalent handler/updater patterns. | `docs/test-rule.md` |
| Keep a short reflection prompt for this recurrence. | `docs/post-mortem/lessons.md` |
