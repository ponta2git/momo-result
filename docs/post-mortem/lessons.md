# Postmortem Lessons

このファイルは、過去の障害・検証漏れを実装時に思い出すための入口である。恒久的な規約にできる内容は、対応する `docs/*-rule.md` に移設する。

## 前提

- 教訓は機械的に全部適用しない。実装・検証前に「今回の変更にこの教訓が有用か」を短く反芻してから使う。
- 有用だと判断した教訓は、作業計画・テスト選択・最終報告のいずれかに反映する。
- 該当しない教訓は無理に適用しない。ただし、該当しない理由を自分で説明できる状態にする。
- 恒久化できる教訓は、このファイルに溜め込まず、`docs/db-rule.md`、`docs/test-rule.md`、`docs/dev-rule.md` などの実行規約へ移す。
- クオリティゲート直前には、このファイルを再確認し、見落とした教訓がないか確認する。

## 使い方

1. 変更対象を確認する。
2. 下の「反芻ポイント」から該当するものだけを選ぶ。
3. 該当したものについて、移設先の規約を読む。
4. 検証できなかった場合は、最終報告で「未検証」と明記する。

## 反芻ポイント

### PostgreSQL / DB-backed API

該当条件:

- `apps/api` の PostgreSQL repository を変更する。
- SQL fragment、Doobie query、DB table/column、migration 前提に触れる。
- APIエラーが `relation does not exist`、SQLSTATE、PostgreSQL syntax/runtime error を含む。

思い出すこと:

- Scala/DoobieでコンパイルできたSQLは、PostgreSQLで正しいSQLとは限らない。
- 関連Repositoryのテスト成功は、該当EndpointのDB経路を検証したことにならない。
- `momo-db` にmigrationがあることと、接続先DBに適用済みであることは別である。
- integration test がDB未起動でskipされた場合、DB動作は未検証である。

参照:

- DB契約とcross-repo migration: `docs/db-rule.md`
- DB-backed APIのテスト責務: `docs/test-rule.md`
- ローカルDB起動と検証コマンド: `docs/dev-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-backend-matches-list-db-errors.md`

### テストアーキテクチャ

該当条件:

- テスト追加・修正を伴う。
- 「どのテストを走らせれば十分か」を判断する。
- ある層のテストで別の層の不具合を代用検証しようとしている。

思い出すこと:

- テストは層ごとに責務を分ける。
- DB contract、Repository SQL、HTTP境界、Usecase分岐は別の失敗を捕まえる。
- 事故を起こした実行単位を通さないテストは、再発防止として不十分である。

参照:

- テストレイヤの責務: `docs/test-rule.md`
- DB-backed API変更時の検証: `docs/dev-rule.md`

### Frontend / TanStack Query error visibility

該当条件:

- `apps/web` のTanStack Queryを使うページでAPIエラー表示を追加・変更する。
- `query.error`、`isError`、`isFetching`、`enabled`、認証状態を使ってUI表示を分岐する。
- 一時的なAPI失敗後のremount、refetch、復旧表示に触れる。

思い出すこと:

- `query.error` があることは、現在の読み込みが致命的に失敗していることと同義ではない。
- 認証後に有効化されるqueryは、エラー表示側も認証・`enabled` 前提と合わせる。
- APIエラー表示の回帰テストは、必要に応じて cached error -> remount -> refetch success のような
  query lifecycleを直接通す。

参照:

- TanStack Queryエラー表示の実装規約: `docs/architecture.md`
- web component/pageのテスト責務: `docs/test-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-frontend-masters-query-error-visibility.md`

### Frontend / form interaction execution path

該当条件:

- `apps/web` の form、filter、select、input、button のイベントハンドラを追加・変更する。
- `setState((current) => ...)` の updater 内で event や DOM node を参照している。
- レンダリングテストはあるが、変更した入力操作を user-event で実行していない。

思い出すこと:

- React event 由来の値は handler 内で同期的に退避し、state updater 内では退避済みの値だけを使う。
- UIが表示されることと、ユーザー操作の実行経路が壊れていないことは別である。
- 代表的な form/filter 操作は Testing Library + user-event で直接通す。

参照:

- web component/page の入力操作テスト責務: `docs/test-rule.md`
- 元の事象: `docs/post-mortem/2026-05-03-frontend-matches-filter-event-currenttarget.md`

### Cross-repo schema dependency

該当条件:

- `docs/db-rule.md` にある共有DBまたは `../momo-db` のschema/migrationに依存する。
- API側の変更が、DB migration適用順序に依存する。

思い出すこと:

- migrationが別repoにあることは、consumer側が検証しなくてよい理由にならない。
- deploy前提・ローカル前提・テスト前提を分けて扱う。

参照:

- momo-db / summitアプリ・共有DBとの関係: `docs/db-rule.md`
- ローカルDB・Redis起動: `docs/dev-rule.md`

## 最終報告に含めること

該当する教訓があった場合、最終報告では次を短く述べる。

- どの教訓が該当したか。
- どの規約文書に従ったか。
- どのテスト・コマンドで検証したか。
- DB/integration test がskipされた場合、何が未検証か。
- 追加すべきテストや品質ゲートが残る場合、その残リスク。
