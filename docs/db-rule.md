# DB利用規約

目的: 共有 PostgreSQL の所有権、consumer contract、migration 順序を判断するための正本。

読む条件:

- DB table / column / seed / nullable / default に依存する変更をする。
- PostgreSQL repository、Doobie query、worker の psycopg query、DB-backed API を触る。
- `relation does not exist`、存在しない column、SQLSTATE、FK / unique violation を含むエラーを扱う。

参照:

- ドメイン状態遷移: `docs/domain-rule.md`
- テスト選択: `docs/test-rule.md`
- コマンド: `docs/dev-rule.md`
- Redis/OCR queue: `docs/redis-streams-ocr-contract.md`

## 1. Ownership

| 対象 | 正本 | このrepoの責務 |
|---|---|---|
| schema / migration / seed | `../momo-db` | consumerとして必要な前提を明示し、contract testで検知する |
| PostgreSQL query | `apps/api`, `apps/ocr-worker` | 現在のschema前提に合わせて実行し、PostgreSQL固有挙動をintegration testで確認する |
| DB rowの業務意味論 | `docs/domain-rule.md` | API / worker / web が同じ意味で扱う |

- Neon PostgreSQL は summit アプリと共有する。
- このリポジトリは DB schema を所有しない。必要な schema 変更は先に `momo-db` へ入れる。
- `momo-db` に migration が存在することと、接続先DBに適用済みであることは別問題として確認する。
- 本repo側で migration SQL を複製しない。Testcontainers / CI / E2E は `momo-db` の migration を適用してから実行する。

## 2. Tables Consumed By This App

| 領域 | テーブル | 主なconsumer | 注意 |
|---|---|---|---|
| summit共有 | `members` | API | 固定4名のseedを前提にする。UI定数で局所置換しない。 |
| summit共有 | `held_events`, `held_event_participants` | API | 本アプリ作成の `held_events.session_id` は `NULL` になり得る。 |
| 認証・権限 | `momo_login_accounts`, `app_sessions` | API | ログイン主体と試合参加者を分ける。無効化時はsessionを削除する。 |
| 試合結果 | `matches`, `match_players`, `match_incidents` | API | 確定済み試合の正本。4名、順位、プレー順、事件数を外部契約として検証する。 |
| 下書き | `match_drafts` | API, worker | OCR/手入力の作業単位。terminal状態、OCR slot、画像保持情報を含む。 |
| OCR | `ocr_drafts`, `ocr_jobs`, `ocr_queue_outbox` | API, worker | job状態はDBが正本。Redisは配送路。queue詳細はRedis契約文書へ寄せる。 |
| マスタ | `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases` | API, worker | 作品/マップ/シーズン/事件/名寄せ。IDはFKとして永続化される。 |
| 冪等性 | `idempotency_keys` | API | `(key, account_id, endpoint)` でreplay scopeを分ける。 |

DBに保存してよい画像関連情報は、参照ID、内部一時path、保持期限、削除時刻などの管理情報だけ。画像実体、長寿命URL、公開URL、OCR raw text全文をDB契約として増やさない。

## 3. Critical Assumptions

新しいDB前提を増やす場合は、この章ではなく `DbContractSpec` に機械検査を追加する。この章には、実装判断に必要な要点だけ置く。

- `members` は固定4名 seed を持つ。
- `momo_login_accounts` はログイン可能な操作主体を表す。`player_member_id` は nullable。
- `incident_masters` は固定6種の事件IDを持つ。domainの `IncidentKind` との対応は repository 層で扱う。
- `held_events.session_id` は nullable。本アプリ作成分は `session_id = NULL`、`held_date_iso` は `start_at` のJST日付から埋める。
- `match_drafts.confirmed_match_id` は `status = confirmed` のときだけ必要。`cancelled` と非terminal状態では持たない。
- `ocr_jobs.image_path` は内部処理用の一時pathであり、公開HTTP DTOへ出さない。
- `ocr_queue_outbox.stream_payload` は JSON Schema と Redis contract の対象であり、DB column shapeだけで互換性を判断しない。
- `idempotency_keys.response_status = 0` は処理中予約を表す。

## 4. Consumer Contract

DB-backed API / worker query を触る変更では、同じ変更内で次を確認する。

- 依存する table / column / seed / nullable / default / index / constraint を特定する。
- 新しいDB前提は `apps/api/src/test/scala/momo/api/integration/DbContractSpec.scala` に追加する。
- 変更した repository method または worker adapter を Testcontainers PostgreSQL で実行する。
- 同一 transaction で FK 関連 row を作成・更新する場合、statement order と保存後の linked row values を integration test で確認する。
- 新しい table に書き込む integration test を追加したら、`IntegrationDb.truncateAppTables` など cleanup 対象も更新する。
- integration が skip / 未実行なら、そのDB挙動は未検証として報告する。

標準コマンド:

```sh
cd apps/api
sbt apiDbQuality
```

worker の PostgreSQL adapter を触った場合:

```sh
cd apps/ocr-worker
uv run pytest -m integration
```

## 5. SQL Risk Checklist

次を含む変更は実PostgreSQLで検証する。

- `UNION` / `INTERSECT` / `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- `ON CONFLICT`
- advisory lock
- `UPDATE ... WHERE` で同時実行guardを表す処理
- 複数 table をまたぐ filter / order / limit
- nullable FK と `IS NOT DISTINCT FROM`

PostgreSQL SQLSTATE を業務エラーへ変換する場合は、repository境界で `AppError` / worker failure へ正規化し、HTTP層やworker runnerへDB例外型を漏らさない。

## 6. Migration / Deployment

後方互換なDB変更:

1. `momo-db` に migration を追加する。
2. migration 適用を確認する。
3. consumer 側 API / worker / web を deploy する。

破壊的変更、NOT NULL 追加、型変更、大量 backfill、旧 schema 削除:

- consumer deploy と別 migration に分ける。
- 旧consumerと新consumerが同時に動く期間を考慮する。
- deploy順序、rollback、未移行データの扱いを実装前に決める。
- public docs にprovider固有の復旧手順や実測値を書かない。必要なら `private/` に置く。
