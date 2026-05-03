# アーキテクチャ規約

> この文書への追加も、ルートの AGENTS.md と requirements/ を正本とし、サブディレクトリ固有の実装規約に限定する。

## 1. モノレポ構成

### 1.1 構成概要

実装時は以下の構成を基本とする。

```text
apps/
  web/         React/Vite SPA
  api/         Scala API server
  ocr-worker/  Python OCR worker
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

### 1.2 本番構成

- 本番は同一Fly.ioアプリ、同一ドメインで運用する。
- APIサーバーがweb SPAの静的ファイルを配信する。
- APIサーバーとOCRワーカーは同一VM内の別プロセスとして動かす。
- 同一VM内の複数プロセス管理には `supervisord` を使う。
- web/api/ocr-workerをマルチステージDockerfileでビルドし、単一ランタイムイメージにまとめる。

### 1.3 ローカル開発

- Docker ComposeはDB/Redisだけを起動するために使う。
- web/api/ocr-workerは各言語のdevコマンドで直接起動する。
- ローカルSecretsは `.env`、本番Secretsは `fly secrets`、CI SecretsはGitHub Actions secretsで管理する。

---

## 2. API設計規約

### 2.1 OpenAPI

- API仕様はScala API側のTapirエンドポイント定義を正本にする。
- OpenAPIはTapir定義から生成する。
- web側は生成OpenAPIから `openapi-typescript` で型生成する。
- 手書きOpenAPI YAMLを正本にしない。

### 2.2 Scala API

- Scala 3 + Tapir + http4s + Cats Effect を使う。
- DBアクセスはDoobieを使う。
- 副作用はCats Effectの効果型に閉じ込める。
- HTTPハンドラ内にDB・認証・業務ロジックを直接詰め込まず、責務を分ける。
- エンドポイント定義、入力検証、認証、ユースケース、リポジトリを分離する。
- JSON、CSV/TSV、エラー応答の形式はテストで固定する。

### 2.3 認証・CSRF

- Discord OAuth後のセッションはHttpOnly Secure Cookieで管理する。
- セッションはPostgreSQL/Neonに保存する。
- CookieのSameSiteはLaxを基本とする。
- 状態変更APIにはCSRFトークンを要求する。
- CSRFトークン検証を一部のmutationだけに漏れなく入れるのではなく、状態変更メソッド全体へ統一的に適用する。

### 2.4 エラー設計

- 業務エラー、認証エラー、権限エラー、入力エラー、外部依存エラーを区別する。
- ユーザー修正可能なエラーはUIで説明できる形にする。
- 例外を握りつぶして成功扱いにしない。
- OCR失敗はジョブ失敗として記録し、失敗理由を表示できるようにする。

---

## 3. web実装規約

### 3.1 React

- React/Vite SPAとして実装する。
- ルーティングはReact Routerを使う。
- サーバーデータ管理にはTanStack Queryを使う。
- Suspenseを標準採用し、Error BoundaryとQueryErrorResetBoundaryを画面設計に含める。
- mutation、フォーム保存、バリデーションエラー、ユーザー操作中状態はSuspense任せにせず明示的に扱う。
- TanStack Queryのページ単位エラー表示では、`query.error` だけで失敗表示を確定しない。
  認証や `enabled` の前提、`isFetching` / `fetchStatus` などの取得状態を合わせて、再取得中の過去エラーを現在の致命的な失敗として表示しない。

### 3.2 フォーム

- フォームはConform + Zodを使う。
- サーバー側でも同等の検証を行う。
- 重要な確定操作、削除操作、画像上書き操作には明示的な確認UIを置く。

### 3.3 APIクライアント

- `openapi-typescript` で生成した型を使う。
- HTTP呼び出しはブラウザ標準 `fetch` を薄くラップする。
- API呼び出しのエラーをUIで扱える形に正規化する。
- 認証Cookie前提のため、credential設定やCSRFトークン送信を忘れない。

### 3.4 UI

- Tailwind CSSを使う。
- 外部コンポーネントライブラリに依存せず、必要なコンポーネントを自作する。
- キーボード操作、ラベル、フォーカス表示、コントラストなど基本的なWCAG AA相当を目指す。
- 画像アップロード/CSV出力系はPC主対象。その他の機能はスマホでも快適に操作できることを目指す。

---

## 4. OCRワーカー実装規約

- Python + uvで管理する。
- 第一候補ライブラリはTesseract + OpenCV/Pillow。
- 画像種別ごとに独立した解析器を作る。
- 共通前処理だけ共有する。
- 解析器は、入力画像、種別判定、抽出結果、信頼度、警告、失敗理由を明確に扱う。
- 低信頼度の項目は確認画面で強調表示できるよう、項目単位の信頼度または警告を返す。
- 画像ファイルは処理完了後に確実に削除する。
- 一時画像が存在しない場合はジョブ失敗として扱い、再アップロードを促せる状態にする。

---

## 5. セキュリティ・プライバシー

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

## 6. 可観測性・運用

- アプリケーションログは構造化JSONログにする。
- MVPではFly.ioログ確認を主な運用手段にする。
- `/healthz` はAPIプロセスの生存のみ確認する。
- DB/Redis接続は別の詳細ヘルスで確認する。
- 通常画面/APIは体感1秒以内を目標にする。
- CSV/TSV出力は数秒以内を目標にする。
- OCRは非同期処理とし、処理時間を記録する。
- DBバックアップ/復旧はNeonのPITR/バックアップ機能に依存する。
