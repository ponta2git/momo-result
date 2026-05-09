# 桃鉄結果記録・集計アプリ 技術構成・非機能要件

本書は `requirements/base.md` で定めた業務要求を実現するための技術構成、運用方針、非機能要件を定める。

---

## 1. 全体方針

- 本アプリはこのリポジトリ内のモノレポとして管理する。
- フロントエンド、APIサーバー、OCRワーカーは論理的に分離する。
- 本番では低コスト運用を優先し、同一Fly.ioアプリ、同一ドメイン、同一VM内で稼働させる。
- DBは summit アプリと共有する Neon PostgreSQL を利用する。
- OCRジョブキューには Upstash Redis を利用する。

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

- React/Vite のSPAとする。
- ルーティングは React Router を使う。
- スタイリングは Tailwind CSS を使う。
- UIコンポーネントは外部コンポーネントライブラリに依存せず、自作する。

### 3.2 フォーム・バリデーション

- フォームは Conform + Zod を使う。
- 業務バリデーションのうち、クライアントで即時判定できるものはZodで表現する。
- サーバー側でも同等の検証を行い、クライアント検証だけに依存しない。

### 3.3 API型・クライアント

- API仕様はScala API側の Tapir エンドポイント定義を正本とする。
- Tapir定義からOpenAPIを生成する。
- web側は `openapi-typescript` で型を生成する。
- HTTP呼び出しはブラウザ標準 `fetch` を薄くラップして手書きする。

### 3.4 サーバーデータ管理

- API取得・サーバーデータ管理には TanStack Query を使う。
- Suspenseを標準採用する。
- 画面設計には Error Boundary と QueryErrorResetBoundary を含める。
- mutation、フォーム保存、バリデーションエラーなどは、Suspense任せにせず明示的に状態を扱う。

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

### 4.3 認証・セッション

- Discord OAuthでログインする。
- OAuth後はAPIサーバーがHttpOnly Secure Cookieのサーバーサイドセッションを管理する。
- サーバーサイドセッションはPostgreSQL/Neonに保存する。
- CookieのSameSiteはLaxを基本とする。
- 状態変更APIにはCSRFトークンを要求する。

---

## 5. OCRワーカー

### 5.1 基本構成

- OCRワーカーはPythonで実装する。
- OCRライブラリは Tesseract + OpenCV/Pillow を第一候補とする。
- OCR/画像解析には外部APIを使わない。
- 画像種別ごとに独立した解析器を作り、共通前処理だけ共有する。

### 5.2 ジョブキュー

- Upstash RedisのRedis StreamsでOCRジョブキューを実装する。
- OCRジョブ状態の正本はDBに置く。
- Redis Streamsは配送キューとして使う。
- OCRワーカーの同時処理数は設定値で変更可能にする。
- MVP初期値は1ジョブ直列処理とする。

### 5.3 ジョブ記録

OCRジョブごとに以下をDBに保存する。

- 開始時刻
- 終了時刻
- 処理時間
- 失敗理由
- 画像種別

OCRジョブのタイムアウトとリトライ回数は、実際のOCR処理時間を計測してから決める。MVPでは処理時間を記録できる状態にしておく。

---

## 6. 画像アップロード・一時ファイル

- アップロード可能な画像形式は PNG/JPEG/WebP とする。
- 画像アップロードは1枚3MBまでに制限する。
- アップロード画像はFly.io VMの一時ディスクに保存する。
- OCR完了時点では画像を削除しない。下書き確定またはキャンセルまで保持し、その後削除する。
- OCR待ち中にVM再起動などで一時画像が失われた場合は、ジョブを失敗扱いにし、ユーザーに再アップロードを求める。
- 画像はサーバーに恒久保存しない。

---

## 7. DB・スキーマ管理

### 7.1 DB

- DBは Neon PostgreSQL を使い、summit アプリと共有する。
- DBスキーマの正本は `~/Documents/codes/momo-db` リポジトリ（`@momo/db` パッケージ）に集約する。
- 本アプリは momo-db が公開する `members` / `held_events` / `held_event_participants` / `app_sessions` / `ocr_drafts` / `ocr_jobs` などをDB契約として参照する。
- 本アプリ専用の試合結果系テーブル（`matches` / `match_players` / `match_incidents`）と、共有マスタ（`game_titles` / `map_masters` / `season_masters` / `incident_masters` / `member_aliases`）も momo-db に追加する。

### 7.2 マイグレーション

- DBマイグレーションの所有権は momo-db に集約する。
- 本アプリと summit はそれぞれ `pnpm install` で `@momo/db` の `dist/` を参照する（または Scala 側はSQL契約として参照する）。
- スキーマ変更時は momo-db で `pnpm db:generate` → SQL レビュー → `pnpm db:migrate` → `pnpm build` を行う。
- 本番への migration は momo-db の master push で GitHub Actions が `drizzle-kit migrate` を実行する。
- 消費プロジェクト（本アプリ・summit）の deploy 前に momo-db の migration が適用済みであることを確認する。

### 7.3 DB契約テスト

- API結合テストでローカルPostgreSQLに期待スキーマを作る。
- 主要クエリを実行し、DB契約の不整合を検出する。

---

## 8. ローカル開発

- ローカル開発では Docker Compose でDB/Redisだけを起動する。
- web/api/ocr-workerは各言語のdevコマンドで起動する。
- ローカルの環境変数は `.env` で管理する。

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

CIでは以下を必須チェックにする。

- format
- lint
- typecheck
- unit test
- API integration test
- E2E smoke test
- build

### 10.2 フォーマッタ・リンタ

| 対象 | ツール |
|---|---|
| web | oxlint + oxfmt |
| api | scalafmt + scalafix |
| ocr-worker | ruff |

### 10.3 テスト

MVPでは各層の単体テスト、API結合テスト、主要E2Eを最小限実施する。

| 対象 | ツール |
|---|---|
| web | Vitest + Testing Library |
| api | MUnit |
| ocr-worker | pytest |
| E2E | Playwright |

---

## 11. セキュリティ

- ログイン可能なユーザーは固定4名に限定する。
- Discord OAuth後のセッションはHttpOnly Secure Cookieで管理する。
- セッションはPostgreSQL/Neonに保存する。
- 状態変更APIにはCSRFトークンを要求する。
- ログイン、画像アップロード、CSV/TSV出力に軽いレート制限を入れる。
- アップロード画像はサイズと形式を検証する。
- 画像は下書き確定またはキャンセルまで保持し、その後削除する。サーバーに恒久保存しない。

---

## 12. 可観測性・運用

### 12.1 ログ

- アプリケーションログは構造化JSONログとする。
- MVPではFly.ioログ確認を主な運用手段とする。

### 12.2 ヘルスチェック

- `/healthz` はAPIプロセスの生存のみ確認する。
- DB/Redis接続は別の詳細ヘルスで確認する。

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

- キーボード操作、ラベル、コントラストなど、基本的なWCAG AA相当を目指す。

---

## 15. 運用チューニング事項

- OCRジョブのタイムアウト初期値は30秒とし、`OCR_TIMEOUT_SECONDS` で変更可能にする。
- OCRジョブのRedis配送上限初期値は1回とし、`OCR_MAX_ATTEMPTS` で変更可能にする。
- 実測に応じて timeout / retry / DLQ の値を調整する。
