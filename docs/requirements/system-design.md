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
- OCR worker はデコード後メモリ保護のため、4K（3840x2160）を超える寸法の画像を処理しない。
- アップロード画像はFly.io VMの一時ディスクに保存する。
- OCR完了時点では画像を削除しない。下書き確定またはキャンセルまで保持し、その後削除する。
- OCR待ち中にVM再起動などで一時画像が失われた場合は、ジョブを失敗扱いにし、ユーザーに再アップロードを求める。
- 画像はサーバーに恒久保存しない。
- DBには画像実体、内部ファイルパス、長寿命URLを保存・公開しない。
- 下書きに紐づく source image は認証付きAPI経由でプレビュー・個別取得・zipダウンロードできる。

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

E2E smoke は現行CIの必須チェックではない。E2E smoke scope を拡大する場合は、対象フロー、実行環境、保守コストを決めてから追加する。

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
- ログイン、画像アップロード、CSV/TSV出力に軽いレート制限を入れる。
- アップロード画像はサイズ、形式、寸法、実体を検証する。
- 画像は下書き確定またはキャンセルまで保持し、その後削除する。サーバーに恒久保存しない。
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

### 12.3 バックアップ・復旧

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
