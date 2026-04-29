# AGENTS.md

このファイルは、このリポジトリで作業するAIエージェントおよび開発支援ツール向けの共通指示である。実装時は必ず本書と `requirements/` 配下の仕様を読み、仕様を満たす変更だけを行うこと。

---

## 1. 最優先の参照順

仕様・設計に迷った場合は、以下の優先順位で判断する。

1. `requirements/base.md`
   - 業務要求、MVP範囲、権限、データ項目、CSV/TSV出力などの正本。
2. `requirements/system-design.md`
   - 技術構成、非機能要件、CI、運用、セキュリティなどの正本。
3. この `AGENTS.md`
   - 実装・設計・レビュー時の作業規約。
4. 既存コード、テスト、設定ファイル
   - 実装済みの規約や構造。

`requirements/base.md` と `requirements/system-design.md` に矛盾がある場合は、業務要求は `base.md` を優先し、技術・非機能要件は `system-design.md` を優先する。判断できない場合は、勝手に仕様を補完せずユーザーに確認する。

---

## 2. プロジェクトの目的

このアプリは、毎週開催している深夜の桃鉄1年勝負の結果を記録し、後からCSV/TSVとして出力するためのWebアプリケーションである。

MVPでは以下を対象とする。

- Discord OAuthログイン
- 固定4名だけが使える仲間内運用
- 開催履歴の選択・作成
- 試合結果の作成・編集・確定・削除
- キャプチャーボード撮影または画像アップロード
- OCRによる下書き作成
- 手修正と確定
- マスタ管理
- CSV/TSVダウンロード

集計画面などの参照系UIはMVP後に同じアプリ内へ追加する。MVPではCSV/TSV出力を優先する。

---

## 3. 決定済みアーキテクチャ

### 3.1 モノレポ構成

実装時は以下の構成を基本とする。

```text
apps/
  web/         React/Vite SPA
  api/         Scala API server
  ocr-worker/ Python OCR worker
```

言語・ツールは以下を使う。

| 領域 | 技術 |
|---|---|
| web | React, Vite, pnpm, React Router, TanStack Query, Conform, Zod, Tailwind CSS |
| api | Scala 3, sbt, Tapir, http4s, Cats Effect, Doobie |
| ocr-worker | Python, uv, Tesseract, OpenCV/Pillow, pytest |
| DB | Neon PostgreSQL（スキーマ正本は `~/Documents/codes/momo-db`、`@momo/db` パッケージ経由で参照） |
| Queue | Upstash Redis Streams |
| Deploy | Fly.io |
| Process management | supervisord |

### 3.2 本番構成

- 本番は同一Fly.ioアプリ、同一ドメインで運用する。
- APIサーバーがweb SPAの静的ファイルを配信する。
- APIサーバーとOCRワーカーは同一VM内の別プロセスとして動かす。
- 同一VM内の複数プロセス管理には `supervisord` を使う。
- web/api/ocr-workerをマルチステージDockerfileでビルドし、単一ランタイムイメージにまとめる。

### 3.3 ローカル開発

- Docker ComposeはDB/Redisだけを起動するために使う。
- web/api/ocr-workerは各言語のdevコマンドで直接起動する。
- ローカルSecretsは `.env`、本番Secretsは `fly secrets`、CI SecretsはGitHub Actions secretsで管理する。

---

## 4. momo-db / summitアプリ・共有DBとの関係

このアプリは Neon PostgreSQL を summit アプリと共有する。スキーマと migration の正本は `~/Documents/codes/momo-db`（`@momo/db` パッケージ）に集約されている。

重要な前提:

- DBスキーマと migration は momo-db リポジトリで一元管理する（drizzle-orm + drizzle-kit）。
- summit と本アプリは `@momo/db` の dist/型 を参照する（Scala API は SQL 契約として参照）。
- `members` / `held_events` / `held_event_participants` / `app_sessions` / `ocr_drafts` / `ocr_jobs` は momo-db が公開する共有テーブル。
- summit は Discord 出席 session に紐づく形で `held_events` を作成する。本アプリも `held_events` を作成できる。本アプリ作成分は `held_events.session_id` が NULL になる。
- 1つの `held_events` に複数の桃鉄1年勝負結果を紐づけられる。
- 本番 migration は momo-db の master push 時に GitHub Actions が `drizzle-kit migrate` を実行する。
- 消費プロジェクト（本アプリ・summit）の deploy 前に、momo-db の migration が適用済みであることを確認する。

実装時の注意:

- 本リポジトリから momo-db / summit のスキーマを無断変更しない。
- DBスキーマ変更が必要な場合は、まず momo-db に PR を出し、消費プロジェクト側の影響と deploy 順序を明示する。
- 本アプリ専用の試合結果系テーブル（`matches` / `match_players` / `match_incidents`）と共有マスタ（`game_titles` / `map_masters` / `season_masters` / `incident_masters` / `member_aliases`）も momo-db に配置する。
- API結合テストではローカルPostgreSQLに momo-db の migration を適用し、主要クエリを実行してDB契約を検証する。

---

## 5. 業務ルールの不変条件

以下は実装・テスト・レビュー時に常に守る。

### 5.1 ユーザー・権限

- ログイン方式はDiscord OAuth。
- ログイン可能なユーザーは固定4名だけ。
- Discord OAuthユーザーは summit の `members.user_id` と紐づける。
- 初期管理者は「ぽんた」。
- 管理者だけがログイン可能アカウントの許可を管理できる。
- ログイン済み固定4名は、結果作成・修正・確定・削除、マスタ管理、CSV/TSVダウンロードができる。
- 確定済み結果の修正履歴は保存しない。
- 削除は物理削除とし、削除前確認を必須にする。

### 5.2 試合結果

試合結果の確定には以下を必須とする。

- 開催日時
- 作品名
- シーズン
- オーナー
- マップ
- 固定4名全員のプレー順
- 固定4名全員の順位

固定4名全員の順位は1〜4で重複してはならない。

金額の保存単位:

- 総資産額は万円単位の整数。
- 収益額は万円単位の整数。

順位:

- 総資産額から自動計算しない。
- OCRまたは手入力された順位を正として保存する。

プレー順:

- 画像内の色順から判別する。
- 色順は青、赤、黄、緑。
- 画面下のインジケータ左から順番とする。
- 判別結果は手修正可能にする。

### 5.3 マスタ

MVPで扱うマスタ:

- 作品
- マップ
- シーズン
- 事件名
- プレーヤー名エイリアス

事件簿はMVPでは以下の6項目固定とする。

- 目的地
- プラス駅
- マイナス駅
- カード駅
- カード売り場
- スリの銀次

OCR上のプレーヤー名とDB上のメンバー名が一致しない場合に備え、メンバーごとに複数の表示名エイリアスを持てるようにする。

### 5.4 CSV/TSV

- CSV/TSVダウンロードは非公開API。
- ログイン中UIからのみ実行できる。
- ログイン済み固定4名全員が利用できる。
- 出力範囲は、全試合、シーズン単位、`held_events` 単位、試合単位。
- 1行は1プレイヤーの試合結果明細。
- 列順は `requirements/base.md` の「CSV/TSV出力」を正とする。

---

## 6. 画像・OCRの不変条件

### 6.1 画像取り込み

- 取り込み方法はキャプチャーボード撮影と画像アップロードの両方。
- 対象画像種別は総資産、収益額、桃鉄事件簿。
- 画像種別は自動判別する。
- 誤判定時はユーザーが手動で種別変更できる。
- 同じ種類の画像を複数取り込んだ場合は最新結果で上書きする。
- 画像なしの手入力だけでも結果確定できる。

### 6.2 一時保存

- アップロード可能な形式はPNG/JPEG/WebP。
- 画像サイズは1枚3MBまで。
- アップロード画像はFly.io VMの一時ディスクへ保存する。
- OCR完了後、画像は削除する。
- 下書きには画像を残さない。
- サーバーに画像を恒久保存しない。
- OCR待ち中にVM再起動などで一時画像が失われた場合、ジョブを失敗扱いにし、ユーザーに再アップロードを求める。

### 6.3 OCRジョブ

- OCR/画像解析に外部APIを使わない。
- OCRジョブキューはUpstash Redis Streams。
- OCRジョブ状態の正本はDB。
- Redis Streamsは配送キューとして扱う。
- OCRワーカーの同時処理数は設定値で変更可能にし、MVP初期値は1ジョブ直列。
- OCRジョブごとに開始時刻、終了時刻、処理時間、失敗理由、画像種別をDBに保存する。
- OCRタイムアウト値とリトライ回数は未確定。Tesseract + OpenCV/Pillowでの実測後に決定する。

---

## 7. API設計規約

### 7.1 OpenAPI

- API仕様はScala API側のTapirエンドポイント定義を正本にする。
- OpenAPIはTapir定義から生成する。
- web側は生成OpenAPIから `openapi-typescript` で型生成する。
- 手書きOpenAPI YAMLを正本にしない。

### 7.2 Scala API

- Scala 3 + Tapir + http4s + Cats Effect を使う。
- DBアクセスはDoobieを使う。
- 副作用はCats Effectの効果型に閉じ込める。
- HTTPハンドラ内にDB・認証・業務ロジックを直接詰め込まず、責務を分ける。
- エンドポイント定義、入力検証、認証、ユースケース、リポジトリを分離する。
- JSON、CSV/TSV、エラー応答の形式はテストで固定する。

### 7.3 認証・CSRF

- Discord OAuth後のセッションはHttpOnly Secure Cookieで管理する。
- セッションはPostgreSQL/Neonに保存する。
- CookieのSameSiteはLaxを基本とする。
- 状態変更APIにはCSRFトークンを要求する。
- CSRFトークン検証を一部のmutationだけに漏れなく入れるのではなく、状態変更メソッド全体へ統一的に適用する。

### 7.4 エラー設計

- 業務エラー、認証エラー、権限エラー、入力エラー、外部依存エラーを区別する。
- ユーザー修正可能なエラーはUIで説明できる形にする。
- 例外を握りつぶして成功扱いにしない。
- OCR失敗はジョブ失敗として記録し、失敗理由を表示できるようにする。

---

## 8. web実装規約

### 8.1 React

- React/Vite SPAとして実装する。
- ルーティングはReact Routerを使う。
- サーバーデータ管理にはTanStack Queryを使う。
- Suspenseを標準採用し、Error BoundaryとQueryErrorResetBoundaryを画面設計に含める。
- mutation、フォーム保存、バリデーションエラー、ユーザー操作中状態はSuspense任せにせず明示的に扱う。

### 8.2 フォーム

- フォームはConform + Zodを使う。
- サーバー側でも同等の検証を行う。
- 重要な確定操作、削除操作、画像上書き操作には明示的な確認UIを置く。

### 8.3 APIクライアント

- `openapi-typescript` で生成した型を使う。
- HTTP呼び出しはブラウザ標準 `fetch` を薄くラップする。
- API呼び出しのエラーをUIで扱える形に正規化する。
- 認証Cookie前提のため、credential設定やCSRFトークン送信を忘れない。

### 8.4 UI

- Tailwind CSSを使う。
- 外部コンポーネントライブラリに依存せず、必要なコンポーネントを自作する。
- キーボード操作、ラベル、フォーカス表示、コントラストなど基本的なWCAG AA相当を目指す。
- 画像アップロード/CSV出力系はPC主対象。その他の機能はスマホでも快適に操作できることを目指す。

---

## 9. OCRワーカー実装規約

- Python + uvで管理する。
- 第一候補ライブラリはTesseract + OpenCV/Pillow。
- 画像種別ごとに独立した解析器を作る。
- 共通前処理だけ共有する。
- 解析器は、入力画像、種別判定、抽出結果、信頼度、警告、失敗理由を明確に扱う。
- 低信頼度の項目は確認画面で強調表示できるよう、項目単位の信頼度または警告を返す。
- 画像ファイルは処理完了後に確実に削除する。
- 一時画像が存在しない場合はジョブ失敗として扱い、再アップロードを促せる状態にする。

---

## 10. テスト・品質ゲート

MVPでも以下のテストを実装対象に含める。

| 領域 | ツール | 目的 |
|---|---|---|
| web | Vitest + Testing Library | UI部品、フォーム、APIエラー表示 |
| api | MUnit | ユースケース、バリデーション、エラー変換 |
| api integration | MUnit + local PostgreSQL | DB契約、主要クエリ、認証・権限 |
| ocr-worker | pytest | 画像種別判定、解析器、失敗処理 |
| E2E | Playwright | ログイン後の主要フローのsmoke |

CIでは以下を必須チェックにする。

- format
- lint
- typecheck
- unit test
- API integration test
- E2E smoke test
- build

品質ツール:

| 領域 | ツール |
|---|---|
| web | oxlint + oxfmt |
| api | scalafmt + scalafix |
| ocr-worker | ruff |

実装時は、既存のスクリプトやCI設定がある場合はそれに従う。未整備の場合は、この表に沿って標準コマンドを整備する。

---

## 11. セキュリティ・プライバシー

- Secretsをリポジトリにコミットしない。
- `.env` はローカル専用とし、必要なら `.env.example` に非秘密のキー名だけを書く。
- 本番Secretsは `fly secrets` で管理する。
- CI SecretsはGitHub Actions secretsで管理する。
- 画像はOCR完了後に削除し、恒久保存しない。
- OCR/画像解析に外部APIを使わない。
- ログに画像内容、セッションID、OAuth token、CSRF token、個人情報、Secretsを出さない。
- ログイン、画像アップロード、CSV/TSV出力には軽いレート制限を入れる。
- アップロード画像は形式、サイズ、実体を検証する。

---

## 12. 可観測性・運用

- アプリケーションログは構造化JSONログにする。
- MVPではFly.ioログ確認を主な運用手段にする。
- `/healthz` はAPIプロセスの生存のみ確認する。
- DB/Redis接続は別の詳細ヘルスで確認する。
- 通常画面/APIは体感1秒以内を目標にする。
- CSV/TSV出力は数秒以内を目標にする。
- OCRは非同期処理とし、処理時間を記録する。
- DBバックアップ/復旧はNeonのPITR/バックアップ機能に依存する。

---

## 13. 実装時の作業規約

- 仕様を変える必要がある場合は、先に `requirements/base.md` または `requirements/system-design.md` を更新する。
- 既存仕様に反する実装をしない。
- 未確定事項は勝手に決めず、ユーザー確認または仕様書への明示的な「未確定事項」として扱う。
- 小さく動く薄い実装より、仕様の不変条件を壊さない完全な実装を優先する。
- ただし、MVP範囲外の集計画面などを先回りして実装しない。
- 共有DB、認証、画像削除、CSRF、権限チェックは省略しない。
- 例外や失敗を握りつぶさない。
- ユーザーが修正可能なエラーはUI/APIで説明できる形にする。
- 既存コードやテストがある場合は、その規約に合わせる。
- 変更後は該当するformat/lint/typecheck/test/buildを実行する。

---

## 14. サブディレクトリ別instructionの方針

現時点では `apps/` ディレクトリが未作成のため、サブディレクトリ別の `AGENTS.md` は作らない。

将来、各アプリの実体ができた後に必要なら以下を追加する。

- `apps/web/AGENTS.md`
- `apps/api/AGENTS.md`
- `apps/ocr-worker/AGENTS.md`

追加する場合も、このルート `AGENTS.md` と `requirements/` 配下を正本とし、サブディレクトリ固有の実装規約だけを書く。
