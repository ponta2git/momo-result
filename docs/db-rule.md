# DB利用規約

## 1. momo-db / summitアプリ・共有DBとの関係

このアプリは Neon PostgreSQL を summit アプリと共有する。スキーマと migration の正本は `~/Documents/codes/momo-db`（このリポジトリからは `../momo-db`、`@momo/db` パッケージ）に集約されている。

重要な前提:

- DBスキーマと migration は momo-db リポジトリで一元管理する（drizzle-orm + drizzle-kit）。
- スキーマ定義は `../momo-db/src/schema.ts`、適用済みmigrationは `../momo-db/drizzle/` を参照する。
- summit と本アプリは `@momo/db` の dist/型 を参照する（Scala API は SQL 契約として参照）。
- `members` / `held_events` / `held_event_participants` / `app_sessions` / `ocr_drafts` / `ocr_jobs` は momo-db が公開する共有テーブル。
- summit は Discord 出席 session に紐づく形で `held_events` を作成する。本アプリも `held_events` を作成できる。本アプリ作成分は `held_events.session_id` が NULL になる。
- 1つの `held_events` に複数の桃鉄1年勝負結果を紐づけられる。
- 本番 migration は momo-db の master push 時に GitHub Actions が `drizzle-kit migrate` を実行する。
- 消費プロジェクト（本アプリ・summit）の deploy 前に、momo-db の migration が適用済みであることを確認する。

実装時の注意:

- 本リポジトリから momo-db / summit のスキーマを無断変更しない。
- DBスキーマ変更が必要な場合は、まず momo-db に PR を出し、消費プロジェクト側の影響と deploy 順序を明示する。
- 本アプリ専用の試合結果系テーブル（`match_drafts` / `matches` / `match_players` / `match_incidents`）と共有マスタ（`game_titles` / `map_masters` / `season_masters` / `incident_masters` / `member_aliases`）も momo-db に配置する。
- OCRに送信した元画像は、下書き確定またはキャンセルまで編集時の正本として保持する。DBには `match_drafts` のslot別source image IDだけを置き、画像実体、内部path、長寿命URLは保存・公開しない。
- API結合テストではローカルPostgreSQLに momo-db の migration を適用し、主要クエリを実行してDB契約を検証する。

## 2. 消費側APIでのDB契約検証

`momo-db` に migration が存在することと、APIの接続先DBに migration が適用済みであることは別である。DB-backed API を実装・検証するときは、consumerである本リポジトリ側でもDB契約を確認する。

実装時の確認:

- API変更が要求するDB table / column / seed / nullable / default を明示する。
- `../momo-db` 管理テーブルを参照する場合、ローカル検証前に migration を適用する。

```sh
pnpm --dir ../momo-db db:migrate
```

- `relation does not exist`、存在しないcolumn、SQLSTATEを含むDBエラーでは、APIコード修正前に接続先DBのmigration状態を確認する。
- DB契約は `apps/api/src/test/scala/momo/api/integration/DbContractSpec.scala` に追加し、APIが前提にする形状が欠けたら失敗するようにする。
- schema変更が必要な場合は、このリポジトリだけで完結させない。まず `momo-db` のschema/migration変更、消費プロジェクトへの影響、deploy順序を整理する。

deploy順序の原則:

1. `momo-db` に後方互換なmigrationを追加する。
2. migration適用を確認する。
3. consumer側APIをdeployする。
4. 不要になった旧schemaの削除は、consumer側deploy後の別migrationで行う。
