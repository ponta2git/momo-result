# 桃鉄結果記録・集計アプリ 技術構成・非機能要件

本書は `docs/requirements/base.md` で定めた業務要求を実現するための技術構成、運用方針、非機能要件を定める。実装者向けの詳細規約は `docs/architecture.md`、DB所有権は `docs/db-rule.md`、Redis Streams / OCR queue 契約は `docs/redis-streams-ocr-contract.md` を正とする。

---

## 1. 全体方針

- 本アプリはこのリポジトリ内のモノレポとして管理する。
- フロントエンド、APIサーバー、OCRワーカーは論理的に分離する。
- 本番では低コスト運用を優先し、同一Fly.ioアプリ、同一ドメイン、同一VM内で稼働させる。
- DBは summit アプリと共有する Neon PostgreSQL を利用する。
- OCRジョブ配送には Upstash Redis Streams を利用する。
- DB schema / migration は本リポジトリで直接所有せず、`../momo-db` を正本とする。

---

## 2. リポジトリ構成

MVPでは以下のディレクトリ構成を基本とする。

```text
apps/
  web/         React/Vite SPA
  api/         Scala API server
  ocr-worker/ Python OCR worker
```

パッケージ/ビルド管理は言語ごとに分ける。

| 対象 | ツール |
|---|---|
| web | pnpm |
| api | sbt |
| ocr-worker | uv |

---

## 3. フロントエンド

### 3.1 基本構成

- React 19 + Vite のSPAとする。
- ルーティングは React Router を使う。
- スタイリングは Tailwind CSS を使う。
- UIは原則として自作の共有コンポーネントで構成する。
- Dialog / Toast / Tooltip などのアクセシビリティ primitive には Base UI を使える。ただし feature から直接 import せず、`shared/ui` 内に閉じる。

### 3.2 フォーム・バリデーション

- フォームは Conform + Zod を基本にする。
- React 19 の `useActionState` / `useFormStatus` / `useOptimistic` は既存フォーム経路と整合する場合だけ使う。
- 業務バリデーションのうち、クライアントで即時判定できるものはZodで表現する。
- サーバー側でも同等の検証を行い、クライアント検証だけに依存しない。
- フォーム・DTO変換では、route param や hidden state 由来の workflow identifier を落とさない。

### 3.3 API型・クライアント

- API仕様はScala API側の Tapir エンドポイント定義を正本とする。
- Tapir定義から `apps/api/openapi.yaml` を生成する。
- web側は `openapi-typescript` で `apps/web/src/shared/api/generated.ts` を生成する。
- HTTP呼び出しはブラウザ標準 `fetch` を薄くラップして手書きする。
- 共通 client は credential、CSRF、Problem Details 正規化、dev/test account header を一元的に扱う。
- API DTO 変更後は OpenAPI から web 型を再生成し、旧 field / 旧 header の残存を検出する。

### 3.4 サーバーデータ管理

- API取得・サーバーデータ管理には TanStack Query を使う。
- route 単位の lazy loading / fallback には Suspense を使う。
- query/render error は route error boundary で扱う。
- mutation、フォーム保存、バリデーションエラー、ユーザー操作中状態は、Suspense任せにせず明示的に状態を扱う。
- query key は backend resource 名だけでなく、cache に保存する runtime data shape を表す。
- 作成・更新 mutation が作成した resource を同画面で選択・表示する場合は、選択値だけでなく候補リストを供給する query cache も更新または invalidation する。

---

## 4. APIサーバー

### 4.1 言語・フレームワーク

- APIサーバーはScalaで実装する。
- Scala 3 + Tapir + http4s + Cats Effect を使う。
- PostgreSQL/NeonへのDBアクセスは Doobie を使う。

### 4.2 API仕様

- Tapirのエンドポイント定義をAPI仕様の正本とする。
- OpenAPIはTapir定義から生成する。
- 生成されたOpenAPIをweb側の型生成入力にする。
- HTTPエラーは Problem Details として返し、UI が機械可読 `code` を解釈できるようにする。
- JSON mutation は `Idempotency-Key` による replay / in-progress / payload mismatch を扱う。
- 同じ key + 同じ payload の完了済み request は replay する。
- 同じ key + 同じ payload の処理中 request は `409` / `IDEMPOTENCY_IN_PROGRESS` を返す。
- 同じ key + 異なる payload は `409` / `IDEMPOTENCY_PAYLOAD_MISMATCH` を返す。
- upload 以外の mutation request body には `REQUEST_MAX_BYTES` を適用する。既定値は 256 KiB とする。
- 画像 upload request には `UPLOAD_REQUEST_MAX_BYTES` を適用し、画像実体は1枚3MBまでとする。

### 4.3 認証・セッション

- Discord OAuthでログインする。
- OAuth後はAPIサーバーがHttpOnly Cookieのサーバーサイドセッションを管理する。
- サーバーサイドセッションはPostgreSQL/Neonの `app_sessions` に保存する。
- CookieのSameSiteはLaxを基本とする。
- 本番 Cookie は Secure を基本とする。
- 状態変更APIにはCSRFトークンを要求する。
- 認証主体は `momo_login_accounts` とし、試合参加者 `members` とは分離する。
- dev/test では検証済み session の代替として `X-Momo-Account-Id` を使える。本番では外部から送られた account header を信頼しない。

---

## 5. OCRワーカー

### 5.1 基本構成

- OCRワーカーはPython 3.14 + uv で実装する。
- OCRライブラリは Tesseract + OpenCV/Pillow を第一候補とする。
- OCR/画像解析には外部APIを使わない。
- OCR対象画面種別ごとに独立した解析器を作り、共通前処理だけ共有する。
- 解析器は抽出結果、信頼度、警告、失敗理由を返せるようにする。

### 5.2 ジョブキュー

- Upstash RedisのRedis StreamsでOCRジョブ配送を実装する。
- OCRジョブ状態の正本はDBに置く。
- Redis Streamsは配送キューとして使う。
- API は OCR job 作成 transaction 内で `ocr_drafts`、`ocr_jobs`、`ocr_queue_outbox` を作成する。
- `ocr_queue_outbox` が durable enqueue intent の正本であり、Redis publish 完了前でも HTTP request は成功し得る。
- API は OCR job 作成前に Redis health、`ocr_queue_outbox` backlog、dead-letter stream length を確認し、配送基盤が degraded の場合はDB行を作成せず `503` Problem Details で新規受付を一時停止する。
- OCRワーカーの同時処理数は設定値で変更可能にする。
- MVP初期値は1ジョブ直列処理とする。
- worker は terminal DB write before `XACK` を原則とする。

### 5.3 ジョブ記録

OCRジョブごとに以下をDBに保存する。

- 作成時刻
- 更新時刻
- 開始時刻
- 終了時刻
- 処理時間
- requested / detected の OCR対象画面種別
- attempt count
- 失敗理由
- warning / timing payload

OCRジョブのタイムアウト初期値は `OCR_TIMEOUT_SECONDS` で管理する。Redis PEL 回収待ちは `OCR_REDIS_CLAIM_IDLE_SECONDS` で別に管理し、OCR処理 timeout と同じ値として扱わない。

---

## 6. 画像アップロード・一時ファイル

- アップロード可能な画像形式は PNG/JPEG/WebP とする。
- 画像ファイルは1枚3MBまでに制限する。
- upload request 全体の上限は `UPLOAD_REQUEST_MAX_BYTES` で管理する。
- OCR へ進んでいない未参照 upload は account 別に件数・容量上限を持つ。上限は `IMAGE_UPLOAD_UNREFERENCED_COUNT_LIMIT` と `IMAGE_UPLOAD_UNREFERENCED_BYTES_LIMIT` で管理し、超過時は `429` Problem Details で拒否する。
- 一時ディスクの空き容量・使用率水位は `IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES` と `IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT` で管理し、超過時は `503` Problem Details で upload 受付を一時停止する。
- OCR worker はデコード後メモリ保護のため、4K（3840x2160）を超える寸法の画像を処理しない。
- アップロード画像はFly.io VMの一時ディスクに保存する。
- OCR完了時点では画像を削除しない。下書き確定または下書き削除まで保持し、その後削除する。
- OCR へ進まない未参照 upload は `IMAGE_ORPHAN_OLDER_THAN_MINUTES` より古くなった時点で orphan reaper の削除対象とする。MVP既定値は15分、reaper interval は5分とする。
- OCR待ち中にVM再起動などで一時画像が失われた場合は、ジョブを失敗扱いにし、ユーザーに再アップロードを求める。
- 画像はサーバーに恒久保存しない。
- DBには画像実体、内部ファイルパス、長寿命URLを保存・公開しない。
- 下書きに紐づく source image は認証付きAPI経由でプレビュー・個別取得・zipダウンロードできる。
- source image の個別取得・zipダウンロードには account 別の分間 rate limit を適用する。上限は `SOURCE_IMAGE_DOWNLOAD_RATE_LIMIT_PER_MINUTE` で管理し、既定値は60回/分とする。
- source image zip は生成前に元画像合計サイズを検査し、`SOURCE_IMAGE_ARCHIVE_MAX_BYTES` を超える場合は拒否する。既定値は10MiBとする。

---

## 7. DB・スキーマ管理

### 7.1 DB

- DBは Neon PostgreSQL を使い、summit アプリと共有する。
- DBスキーマの正本は momo-db リポジトリに集約する。
- 本アプリは momo-db が公開する `members` / `held_events` / `held_event_participants` / `app_sessions` などをDB契約として参照する。
- 本アプリの認証主体は `momo_login_accounts` で管理する。
- 本アプリ専用・共有の主要テーブルは以下を含む。
  - 試合結果: `match_drafts`, `matches`, `match_players`, `match_incidents`
  - OCR: `ocr_drafts`, `ocr_jobs`, `ocr_queue_outbox`
  - マスタ: `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases`
  - 冪等性: `idempotency_keys`

### 7.2 マイグレーション

- DBマイグレーションの所有権は momo-db に集約する。
- schema 定義は `../momo-db/src/schema.ts`、migration SQL は `../momo-db/drizzle/` を参照する。
- スキーマ変更時は momo-db 側で schema / migration を変更し、consumer への影響と deploy 順序を明示する。
- 消費プロジェクト（本アプリ・summit）の deploy 前に momo-db の migration が適用済みであることを確認する。
- 後方互換でない schema 変更は、migration と consumer deploy を分割する。

### 7.3 DB契約テスト

- DB-backed API を触る場合は、Testcontainers PostgreSQL に momo-db migration を適用して検証する。
- DB contract test は、API が前提にする table / column / seed / nullable / default を確認する。
- repository integration test は、主要クエリを実PostgreSQLで実行する。
- 標準確認コマンドは `cd apps/api && sbt apiDbQuality` とする。

---

## 8. ローカル開発

- ローカル開発では Docker Compose でDB/Redisだけを起動する。
- web/api/ocr-workerは各言語のdevコマンドで起動する。
- ローカルの環境変数は `.env` で管理する。
- 詳細な起動順序と検証コマンドは `docs/dev-rule.md` を正とする。

---

## 9. 本番デプロイ

### 9.1 Fly.io構成

- 本番は同一Fly.ioアプリ、同一ドメインで運用する。
- nginx がweb SPAの静的ファイル配信とAPI reverse proxyを担当する。
- APIサーバーとOCRワーカーはnginxと同一VM内の別プロセスとして動かす。
- 同一VM内の複数プロセス管理には supervisord を使う。

### 9.2 Dockerイメージ

- マルチステージDockerfileで web/api/ocr-worker/nginx をビルドする。
- 本番では単一ランタイムイメージにまとめる。

### 9.3 デプロイフロー

- mainブランチへのmergeでGitHub ActionsからFly.ioへ自動デプロイする。
- 本番Secretsは `fly secrets` で管理する。
- CI SecretsはGitHub Actions secretsで管理する。

### 9.4 環境

- MVPではローカル + 本番のみを用意する。
- 必要に応じてPRごとにNeon branchで検証する。

---

## 10. CI・品質管理

### 10.1 CI必須チェック

現行CIでは対象領域ごとに以下を実行する。

| 対象 | 必須チェック |
|---|---|
| web | OpenAPI型生成、format、lint、typecheck、Vitest、build |
| api | format、lint、clean compile、unit / non-integration test、DB quality gate、Redis quality gate、OpenAPI生成チェック |
| ocr-worker | format、lint、typecheck、pytest |
| runtime / E2E | Docker build、runtime smoke、container image scan、Playwright E2E smoke |

Playwright E2E smoke はUX確定済みのログイン後主要フローに絞る。Vite dev buildで開発用認証ヘッダを使い、API / nginx / OCR worker はDocker runtime containerを実DB/Redis付きで起動して検証する。本番ビルドされたwebはdev auth headerを送らないため、runtime imageのweb検証は `/` と deep link fallback のHTTP smokeに留める。

### 10.2 フォーマッタ・リンタ

| 対象 | ツール |
|---|---|
| web | oxlint + oxfmt |
| api | scalafmt + scalafix |
| ocr-worker | ruff |

### 10.3 テスト

| 対象 | ツール |
|---|---|
| web | Vitest + Testing Library |
| api | MUnit |
| api DB/Redis integration | Testcontainers + MUnit |
| ocr-worker | pytest |

---

## 11. セキュリティ

- ログイン可能なユーザーは `momo_login_accounts` で許可した Discord ID に限定する。
- Discord OAuth後のセッションはHttpOnly Secure Cookieで管理する。
- セッションはPostgreSQL/Neonに保存する。
- 状態変更APIにはCSRFトークンを要求する。
- JSON mutation には `Idempotency-Key` を使い、retry による二重実行を避ける。
- ログイン、画像アップロード、JSON mutation、CSV/TSV出力に軽いレート制限を入れる。
- JSON mutation の account 別 rate limit は `MUTATION_RATE_LIMIT_PER_MINUTE` で管理し、既定値は60回/分とする。`idempotency_keys` の未期限切れ key 数は account 別に `IDEMPOTENCY_ACTIVE_KEY_LIMIT_PER_ACCOUNT` で上限を設け、既定値は240件とする。上限超過時は新規 row を作らず `429` Problem Details を返す。これらは週1開催・1開催4〜6試合・試合後都度OCR・開催後1回exportの通常利用を妨げない余裕を持たせる。
- CSV/TSV出力は scope 指定 export と全件 export の account 別 rate limit を分ける。scope 指定は `EXPORT_RATE_LIMIT_PER_MINUTE` で管理し、既定値は30回/分とする。全件 export は `EXPORT_ALL_RATE_LIMIT_PER_MINUTE` で管理し、既定値は6回/分とする。
- 同期CSV/TSV出力は生成前後に出力規模を検査し、`EXPORT_MAX_ROWS` または `EXPORT_MAX_BYTES` を超える場合は `413` Problem Details で拒否する。既定値は20,000明細行、16MiBとし、週1開催・1開催4〜6試合・開催後1回exportの通常利用を妨げない余裕を持たせる。
- CSV/TSV出力の短時間cacheは、試合編集直後の stale export を避けるためMVPでは導入しない。同期上限に正当な利用が当たり始めた場合は、保持期限、再生成条件、認可境界を設計した非同期exportとして別途扱う。
- OAuth callback は IP 単位のログイン制限に加え、同一 state の callback 連打を provider 呼び出し前に抑制する。上限は `AUTH_CALLBACK_STATE_RATE_LIMIT_PER_MINUTE` で管理し、既定値は3回/分とする。
- Discord OAuth provider の `429` / `5xx` / transport error が続く場合は、短時間 provider 呼び出しを止めて `503` Problem Details を返す。閾値は `AUTH_PROVIDER_FAILURE_THRESHOLD`、停止時間は `AUTH_PROVIDER_BACKOFF_SECONDS` で管理し、既定値は3回・60秒とする。
- アップロード画像はサイズ、形式、寸法、実体を検証する。
- 画像は下書き確定または下書き削除まで保持し、その後削除する。サーバーに恒久保存しない。
- ログに画像内容、セッションID、OAuth token、CSRF token、個人情報、Secrets を出さない。

---

## 12. 可観測性・運用

### 12.1 ログ

- アプリケーションログは本番で1行JSONログとする。
- MVPではFly.ioログ確認を主な運用手段とする。
- 例外ログは秘密情報や個人情報を含めず、必要な相関IDと例外クラス中心に記録する。

### 12.2 ヘルスチェック

- `/healthz` はAPIプロセスの生存のみ確認する。
- DB/Redis接続は `/healthz/details` で確認する。
- dev/prod startup 時のDB contract不一致を fail-fast にするか health warning にするかは未決の運用設計事項とし、`docs/post-mortem/follow-up-actions.md` で追跡する。

### 12.3 費用・攻撃観測

MVPでは外部監視基盤を必須にせず、Fly.io logs と `/healthz/details` を主な観測手段にする。公開 `/healthz/details` は攻撃者へ内部件数を渡しすぎないため、DB/Redis/OCR admission の粗い status と reason に留める。件数や容量は安全なログイベント、DB/Redis確認、Fly.ioメトリクスで見る。

費用増加攻撃を疑うときは、以下を同じ時間帯で確認する。

| 観測対象 | 確認元 | 主なイベント・項目 |
|---|---|---|
| OCR受付数・作成拒否 | API log、`/healthz/details` | `ocr_job_accepted`, `ocr_job_create_rate_limited`, `ocr_job_create_rejected`, `OCR admission rejected`, `ocrAdmission` |
| OCR queue/backlog/DLQ | `docs/redis-streams-ocr-contract.md` の Operations | `ocr_queue_outbox` 件数、Redis stream length、consumer group pending count、DLQ stream length |
| 画像upload容量・一時ディスク | API log、Fly.io volume/VM metrics | `image_upload_accepted`, `image_upload_rate_limited`, `image_upload_admission rejected`, `source_image_orphan_reaper` |
| source image download量 | API log | `source_image_downloaded`, `source_image_archive_downloaded`, `source_image_download_rate_limited`, `source_image_archive_rejected` |
| CSV/TSV export量 | API log | `match_export_completed`, `match_export_rate_limited`, `match_export_rejected` |
| OAuth provider / session負荷 | API log | `auth_login_completed`, `auth_login_rate_limited`, `auth_callback_rejected`, `auth_callback_state_rate_limited`, `auth_oauth_provider_backoff_active`, `auth_oauth_provider_backoff_opened` |

ログに含める値は、相関に必要なID、reason、件数、bytes、例外クラス列に限定する。画像内容、OCR raw text 全文、session / CSRF / OAuth token、Redis URL、DB URL、例外message / stack trace は出さない。

継続的な `rate_limited`、`rejected`、`degraded:*`、DLQ増加、source image / export の bytes 急増を見つけた場合は、対象機能の受付を一時的に絞る、該当env上限を下げる、または provider / Fly.io 側の設定変更要否を人間が判断する。外部監視基盤、WAF、provider plan 変更はこの文書だけでは実行しない。

### 12.4 バックアップ・復旧

- DBバックアップ/復旧はNeonのPITR/バックアップ機能に依存する。
- アプリ側では削除前確認を徹底する。
- 試合結果や下書きは物理削除とする。

---

## 13. 性能要件

- 通常画面/APIは体感1秒以内を目標とする。
- CSV/TSV出力は数秒以内を目標とする。
- OCRは非同期処理とし、ユーザーが待てればよい。
- OCR処理時間は実測し、タイムアウトやリトライ方針の判断材料にする。

---

## 14. 対応環境・アクセシビリティ

### 14.1 ブラウザ

対象ブラウザは以下の最新安定版とする。

- Chrome
- Firefox
- Safari
- Edge

### 14.2 画面サイズ

- 画像アップロード/CSV出力系はPC主対象とする。
- 画像アップロード/CSV出力系のスマホ対応は軽微操作までとする。
- その他の機能はスマホでも快適に操作できることを目指す。

### 14.3 アクセシビリティ

- キーボード操作、ラベル、フォーカス、コントラストなど、基本的なWCAG AA相当を目指す。

---

## 15. 運用チューニング事項

- OCRジョブのタイムアウト初期値は30秒とし、`OCR_TIMEOUT_SECONDS` で変更可能にする。
- OCRジョブのRedis配送上限初期値は1回とし、`OCR_MAX_ATTEMPTS` で変更可能にする。
- Redis PEL claim idle は `OCR_REDIS_CLAIM_IDLE_SECONDS` で変更可能にする。
- 実測に応じて timeout / retry / DLQ の値を調整する。
