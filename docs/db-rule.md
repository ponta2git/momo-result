# DB利用規約

目的: 共有 PostgreSQL の所有権、migration、consumer 側検証を迷わないための正本。

読む条件:

- DB table / column / seed / nullable / default に依存する変更をする。
- PostgreSQL repository、Doobie query、DB-backed API を触る。
- `relation does not exist`、存在しない column、SQLSTATE を含むエラーを扱う。

参照:

- テスト層: `docs/test-rule.md`
- コマンド: `docs/dev-rule.md`
- ドメイン状態遷移: `docs/domain-rule.md`

## 1. Ownership

- Neon PostgreSQL は summit アプリと共有する。
- schema / migration / seed の正本は `../momo-db`。
- このリポジトリは DB schema を所有しない。必要な schema 変更は先に `momo-db` へ入れる。
- `momo-db` の migration が存在することと、API接続先DBに適用済みであることは別問題として確認する。

## 2. Tables Used By This App

| 種別 | テーブル |
|---|---|
| summit共有 | `members`, `held_events`, `held_event_participants`, `app_sessions` |
| 認証・権限 | `momo_login_accounts` |
| 試合結果 | `match_drafts`, `matches`, `match_players`, `match_incidents` |
| OCR | `ocr_drafts`, `ocr_jobs`, `ocr_queue_outbox` |
| マスタ | `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases` |
| 冪等性 | `idempotency_keys` |

注意:

- `held_events.session_id` は nullable。本アプリ作成分は `NULL` になり得る。
- `momo_login_accounts` はログイン主体。`members` は試合参加者マスタ。
- OCR元画像の実体、内部path、長寿命URLはDBに保存しない。DBに置くのは参照ID、保持期限、削除時刻などの管理情報だけ。

## 3. Consumer Contract

DB-backed API を触る変更では、次を同じ変更内で確認する。

- API が必要とする table / column / seed / nullable / default を明示する。
- 新しい DB 前提は `DbContractSpec` に追加する。
- 変更した repository method は Testcontainers PostgreSQL で実行する。
- 同一 transaction で FK 関連 row を作成・更新する場合、statement order と保存後の linked row values を integration test で確認する。
- integration が skip / 未実行なら、その DB 挙動は未検証として報告する。

標準コマンド:

```sh
cd apps/api
sbt apiDbQuality
```

## 4. Deployment

後方互換なDB変更:

1. `momo-db` に migration を追加する。
2. migration 適用を確認する。
3. consumer 側 API / worker / web を deploy する。

破壊的変更、NOT NULL 追加、型変更、大量 backfill、旧 schema 削除:

- consumer deploy と別 migration に分ける。
- deploy 順序、rollback、未移行データの扱いを実装前に決める。
