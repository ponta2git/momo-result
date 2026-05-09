# アーキテクチャ規約

この文書は実装者向けの構造・依存方向・技術選定の正本である。業務要件は `docs/requirements/base.md` を優先し、古い技術構成メモよりもこの文書と実装コードを現在の実装規約として扱う。

## 1. 全体像

| 領域 | 場所 | 技術 | 主な責務 |
|---|---|---|---|
| web | `apps/web` | React 19, Vite, React Router, TanStack Query, Conform, Zod, Tailwind CSS, Base UI primitives | SPA、入力、確認、CSV/TSV取得 |
| api | `apps/api` | Scala 3, sbt, Tapir, http4s, Cats Effect, Doobie | HTTP API、認証、業務ユースケース、DB/Redis接続 |
| ocr-worker | `apps/ocr-worker` | Python 3.12, uv, Tesseract, OpenCV/Pillow, pytest | OCRジョブ処理、画像解析、OCR結果保存 |
| DB | `../momo-db` | Neon PostgreSQL, drizzle | schema/migration の正本 |
| Queue | external | Upstash Redis Streams | OCRジョブ配送 |
| runtime | root `Dockerfile`, `deploy/` | Fly.io, nginx, supervisord | web/api/ocr-worker の単一VM運用 |

本番は同一 Fly.io アプリ・同一ドメイン・単一ランタイムイメージで運用する。nginx が web 静的配信と API reverse proxy を担い、api と ocr-worker は supervisord 管理の別プロセスとして動かす。

## 2. API

- API仕様の正本は Tapir endpoint 定義。手書き OpenAPI を正本にしない。
- `apps/api/openapi.yaml` は生成物だが、web 型生成入力なので差分を確認する。
- HTTP endpoint、入力検証、認証/CSRF、usecase、repository を分離する。
- HTTP層にDB・Redis・業務分岐を直接詰め込まない。
- DBアクセスは Doobie repository に閉じる。SQL実行責務は `docs/test-rule.md` の DB-backed API ルールに従う。
- エラーは業務、認証、権限、入力、外部依存を区別し、UIが説明できる形に正規化する。
- JSON、CSV/TSV、Problem Details、OpenAPI はテストで固定する。

### 認証・CSRF

- Discord OAuth 後の session は HttpOnly Cookie と PostgreSQL `app_sessions` で管理する。
- 本番 Cookie は Secure / SameSite=Lax を基本にする。
- 状態変更 API は CSRF トークンを要求する。mutation ごとの個別漏れを作らず、状態変更メソッド全体へ統一的に適用する。
- dev 認証はローカル・テスト用であり、本番経路に混ぜない。

## 3. Web

### 構成

- `apps/web/src` は `app/`、`features/`、`shared/` の3層に分ける。
- 依存方向は `app -> features -> shared`。`shared` から `app` / `features` を import しない。
- feature 同士で実装詳細を import しない。複数 feature で使う API client、型、UI、query key は `shared/` に置く。
- feature 内は役割で分ける: `api.ts`、`types.ts`、`*ViewModel.ts`、`use*.ts`、`*Page.tsx`、小コンポーネント。
- `*Page.tsx` は composition とページ状態に寄せ、データ取得・mutation・複雑な状態機械は hook / helper に分ける。
- 本番コードから `@/test/*` を import しない。

### UI

- Tailwind CSS を使う。
- Base UI は Dialog / Toast / Tooltip など a11y primitive として `shared/ui` 内に閉じる。feature から Base UI を直接 import しない。
- 共有UIは `shared/ui/{actions,data,feedback,forms,layout,status}` に置く。画面固有UIは feature 配下に置く。
- キーボード操作、label、focus、contrast は WCAG AA 相当を目標にする。
- 画像アップロードとCSV/TSV出力はPC主対象。通常操作はスマホでも破綻しないようにする。

### Server State

- API取得と server state は TanStack Query を使う。
- Suspense は route 配下の読み込みに使う。mutation、フォーム保存、バリデーションエラー、ユーザー操作中状態は明示的に扱う。
- route 単位の fallback は `RouteSuspenseFallback`、query/render error は `RouteErrorBoundary` で扱う。再試行時は QueryClient の状態も必要に応じて reset / invalidate する。
- ページ単位の読み込み失敗表示は `query.error` や `isError` だけで確定しない。認証、`enabled`、`isFetching` / `fetchStatus` を合わせ、過去エラーを再取得中の致命的失敗として表示しない。
- `queryKey` は backend resource 名だけでなく、cache に保存する runtime data shape を表す。同じ resource でも raw response と feature-local ViewModel を同じ key に保存しない。
- 共有 query key は `shared/api/queryKeys.ts`、feature 専属 key は feature 配下の `queryKeys.ts` に置く。
- query key / query function を変更したら、別画面が先に cache へ入れた shape と invalidation 範囲を確認する。

### Form / React 19

- フォームは Conform + Zod を基本にし、サーバー側でも同等の検証を行う。
- React event 由来の値は handler 内で同期的に退避し、state updater 内で event / DOM node を読まない。
- `useActionState` / `useFormStatus` / `useOptimistic` は既存フォーム経路と整合する場合だけ使う。
- `useFormStatus` は同じ `<form>` の子でだけ pending を読める。submit 以外のボタンは `type="button"` を明示する。
- `use(promise)` で TanStack Query の cache / retry / auth error normalization を迂回しない。

### API Client

- web 型は `openapi-typescript` 生成の `shared/api/generated.ts` を使う。
- HTTP呼び出しは `shared/api/client.ts` を通す。credential、CSRF、Problem Details 正規化を各 feature で再実装しない。
- 横断 API client は `shared/api/<resource>.ts` に置く。feature 専用の変換は feature 側で行う。

## 4. OCR Worker

- OCR worker は Python + uv で管理する。
- `momo_ocr/app` は起動・設定・logging、`momo_ocr/features` は機能単位、`momo_ocr/shared` は横断部品にする。
- OCR/画像解析に外部APIを使わない。
- 画像種別ごとに解析器を分け、共通前処理だけ共有する。
- 解析器は入力画像、種別判定、抽出結果、信頼度、警告、失敗理由を返せるようにする。
- OCRジョブ状態の正本はDB、Redis Streams は配送キューとする。
- 一時画像が存在しない場合はジョブ失敗として扱い、再アップロード可能な状態にする。

## 5. 画像・セキュリティ

- Secrets をリポジトリにコミットしない。`.env` はローカル専用、非秘密のキー名だけ `.env.example` に置く。
- ログに画像内容、セッションID、OAuth token、CSRF token、個人情報、Secrets を出さない。
- アップロード画像は PNG/JPEG/WebP、1枚3MBまで。形式、サイズ、実体を検証する。
- OCRに送信した元画像は下書き確定またはキャンセルまで保持し、その後削除する。恒久保存しない。
- DBには画像実体、内部path、長寿命URLを保存・公開しない。参照IDと短命なAPI経路だけを扱う。
- ログイン、画像アップロード、CSV/TSV出力にはレート制限を入れる。

## 6. 運用

- アプリケーションログは本番で1行JSONにする。
- `/healthz` はAPIプロセスの生存確認。DB/Redis接続確認は詳細ヘルスとして分ける。
- 通常画面/APIは体感1秒以内、CSV/TSV出力は数秒以内を目標にする。
- OCRは非同期処理とし、処理時間と失敗理由を記録する。
- DBバックアップ/復旧は Neon の PITR/バックアップ機能に依存する。
