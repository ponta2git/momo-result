# DB利用規約

この文書は DB 所有権、migration、consumer 側検証の正本である。テスト層の責務は `docs/test-rule.md`、コマンドは `docs/dev-rule.md` を参照する。

## 1. 所有権

- Neon PostgreSQL は summit アプリと共有する。
- schema / migration の正本は `../momo-db`。このリポジトリで schema を直接所有しない。
- schema 定義は `../momo-db/src/schema.ts`、migration SQL は `../momo-db/drizzle/` を参照する。
- 本リポジトリが DB schema 変更を必要とする場合は、先に `momo-db` で schema / migration を変更し、consumer への影響と deploy 順序を明示する。

## 2. 参照する主なテーブル

| 種別 | テーブル |
|---|---|
| summit 共有 | `members`, `held_events`, `held_event_participants`, `app_sessions` |
| 試合結果 | `match_drafts`, `matches`, `match_players`, `match_incidents` |
| OCR | `ocr_drafts`, `ocr_jobs`, `ocr_queue_outbox` |
| マスタ | `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases` |
| 冪等性 | `idempotency_keys` |

`held_events.session_id` は nullable。summit 作成分は session に紐づき、本アプリ作成分は `NULL` になり得る。

## 3. 画像データ

- OCR元画像の実体は DB に保存しない。
- DB には `match_drafts` の slot 別 source image ID と保持期限・削除時刻だけを置く。
- 内部ファイルパスと長寿命URLを公開契約にしない。
- 画像実体は下書き確定またはキャンセルまで保持し、その後 API 側の保持ポリシーで削除する。

## 4. Consumer 側の必須確認

`momo-db` に migration があることと、API の接続先 DB に適用済みであることは別である。DB-backed API を触るときは、本リポジトリ側でも契約を確認する。

必須:

- API変更が要求する table / column / seed / nullable / default を明示する。
- 新しい DB 前提は `apps/api/src/test/scala/momo/api/integration/DbContractSpec.scala` に追加する。
- repository SQL は Testcontainers Postgres に `momo-db` migration を適用して実行する。
- `relation does not exist`、存在しない column、SQLSTATE を含むエラーでは、APIコード修正前に接続先DBの migration 状態を確認する。

標準確認:

```sh
cd apps/api
sbt apiDbQuality
```

`apiDbQuality` は `DbContractSpec` と PostgreSQL repository specs を実行する。CI では `MOMO_DB_MIGRATIONS_DIR` で checkout 済みの `momo-db/drizzle` を指定する。

## 5. Deploy 順序

1. `momo-db` に後方互換な migration を追加する。
2. migration 適用を確認する。
3. consumer 側 API / worker / web を deploy する。
4. 旧 schema の削除や破壊的変更は、consumer deploy 後の別 migration に分ける。

破壊的変更、NOT NULL 追加、型変更、大量 backfill が必要な場合は、実装前に deploy 手順を設計する。
