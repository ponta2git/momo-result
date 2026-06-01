# アーキテクチャ規約

目的: API / web / OCR worker の構造、依存方向、実装境界を判断するための正本。

読む条件:

- 新しい module / package / feature を作る。
- API / web / OCR worker の境界、依存方向、wire契約を変える。
- 認証、エラー、画像、server state、外部I/O、runtime構成を触る。

役割:

- この文書は「どう実装するか」を扱う。
- 業務意味論は `docs/domain-rule.md`、DB所有権は `docs/db-rule.md`、Redis/OCR queue は `docs/redis-streams-ocr-contract.md` を正とする。
- テスト選択は `docs/test-rule.md`、実行コマンドは `docs/dev-rule.md` を正とする。

## 1. System Map

| 領域 | 場所 | 主な技術 | 責務 |
|---|---|---|---|
| web | `apps/web` | React 19, React Router 7, TanStack Query 5, Conform, Zod, Tailwind CSS 4, Base UI | SPA、入力、確認、CSV/TSV取得 |
| api | `apps/api` | Scala 3, Tapir, http4s, Cats Effect, Doobie | HTTP API、認証、業務usecase、DB/Redis接続 |
| ocr-worker | `apps/ocr-worker` | Python 3.14, uv, Tesseract, OpenCV/Pillow | OCRジョブ処理、画像解析、OCR結果保存 |
| DB | `../momo-db` | Neon PostgreSQL, drizzle | schema / migration / seed の正本 |
| Queue | Upstash Redis Streams | Redis Streams | OCRジョブ配送 |
| runtime | `Dockerfile`, `deploy/` | Fly.io, nginx, supervisord | 単一runtime imageで web / api / worker を起動 |

本番は同一 Fly.io アプリ、同一ドメイン、単一 runtime image で運用する。nginx は web 静的配信と API reverse proxy を担い、api と worker は supervisord 管理の別プロセスにする。provider固有の詳細手順、secret、攻撃対策の手順は public docs に置かない。

## 2. API

### 2.1 Wire Boundary

- API仕様の正本は Tapir endpoint 定義。`apps/api/openapi.yaml` は生成物だが、web 型生成入力なので差分確認対象にする。
- Auth のように Tapir 定義と手書き http4s route が分かれる場合も、path / query / header の wire契約は共有定数から参照する。OpenAPI と実routeの文字列を二重管理しない。
- HTTP endpoint、入力検証、認証/CSRF、usecase、repository を分離する。HTTP層へDB・Redis・業務分岐を直接詰め込まない。
- composition root は `momo.api.bootstrap`。HTTP module は endpoint / middleware / routing に閉じる。
- idempotency / rate limit / logging で使う HTTP operation label は `momo.api.http.HttpOperation` に集約する。label は replay scope として永続化されるため、route 変更時も互換性判断に含める。
- path / query / body / queue payload の raw value は境界で domain/application 型へ変換する。usecase に wire表現を渡さない。
- raw String ID は `BoundaryId` または各 ID の `fromString` で検証する。境界で `unsafeFromString` を使わない。
- optional field の有無で mode や副作用が変わる場合、その field は mode discriminator として扱う。意味論は生成 OpenAPI だけに置かず、要件・ドメイン・API規約に文章で残す。

API境界の一部は `ApiEndpointsArchitectureSpec` と `ApiRuntimeArchitectureSpec` で固定している。新しい境界規約を追加したら、文書だけでなく該当する architecture spec か lint へ寄せられないか確認する。

### 2.2 Usecase / Repository

- usecase は状態遷移、整合性、副作用を扱う。repository は SQL とDB入出力に閉じる。
- 部分更新は入力差分だけで判定しない。既存値と入力値をマージした保存予定の実効状態で不変条件を検証する。
- 読み取りで検証した前提を後続更新で使う場合は、検証済みスナップショットを repository 契約に渡し、`UPDATE ... WHERE` で同時に照合する。
- usecase / HTTP test で使う in-memory adapter は、DB adapter の状態遷移 guard と同じ契約を表現する。DB側の guard が複数 table にまたがる場合は、対応する composite adapter 側で等価の判定を持つ。
- PostgreSQL repository / migration 前提に触れたら `docs/db-rule.md` と `docs/test-rule.md` の DB-backed API ルールに従う。

### 2.3 Error / Auth

- エラーは業務、認証、権限、入力、外部依存を区別し、UIが扱える Problem Details に正規化する。
- Discord OAuth session は HttpOnly Cookie と PostgreSQL `app_sessions` で管理する。
- 認証主体は `momo_login_accounts`。試合参加者 `members` と混同しない。
- 状態変更 API は CSRF token を要求する。dev/test 認証はローカル・テスト専用で本番経路へ混ぜない。
- 409、413、429、503 はUIが意味を扱う可能性がある。汎用内部エラーへ潰さない。

## 3. Web

### 3.1 Layering

- `apps/web/src` は `app/`、`features/`、`shared/` の3層に分ける。
- 依存方向は `app -> features -> shared`。逆方向 import と feature 間の実装詳細 import を禁止する。
- `app` から feature への静的 import は `app/routeModules.ts` へ集約する。
- `features/matches/list`、`features/matches/workspace`、試合詳細の実装詳細を相互 import しない。
- 横断 API client、生成型、query key、共有UI、共通domain helperは `shared/` に置く。画面固有の状態・変換・UIは feature 配下に置く。
- `*Page.tsx` は composition とページ状態に寄せ、データ取得・mutation・複雑な状態機械は hook / controller / helper へ分ける。
- 本番コードから `@/test/*`、`shared/api/msw/*` を import しない。

web の import 境界は `apps/web/scripts/check-architecture-imports.mjs` で検査する。新しい層ルールを追加したら、可能な範囲でこの検査へ反映する。

### 3.2 UI

- Tailwind CSS を使う。
- Base UI は a11y primitive として `shared/ui` に閉じる。feature から Base UI を直接 import しない。
- 共有UIは `shared/ui/{actions,data,feedback,forms,layout,status}` に置く。
- keyboard、label、focus、contrast は WCAG AA 相当を目標にする。
- 画像アップロードとCSV/TSV出力はPC主対象。通常操作はスマホでも破綻させない。

### 3.3 Server State

- API取得と server state は TanStack Query を使う。
- feature Page から TanStack Query を直接 import せず、use* hook / controller に寄せる。
- route 読み込みは Suspense 可。mutation、フォーム保存、validation error、ユーザー操作中状態は明示的に扱う。
- ページ失敗表示は `query.error` / `isError` だけで確定しない。認証、`enabled`、`isFetching` / `fetchStatus`、過去errorの再取得中状態を合わせる。
- `queryKey` は cache に保存する runtime data shape を表す。同じ backend resource でも raw response と ViewModel を同じ key に置かない。
- mutation 後に同画面で作成 resource を選択・表示する場合は、選択値だけでなく候補 list/select の cache も整合させる。

### 3.4 Form / React

- フォームは Conform + Zod を基本にし、サーバー側でも同等の検証を行う。
- React event 由来の値は handler 内で同期的に退避する。state updater 内で event / DOM node を読まない。
- route param、prefill、hidden state 由来の workflow identifier を request transform で落とさない。
- `useActionState` / `useFormStatus` / `useOptimistic` / `<Activity>` は、既存経路より複雑さや不具合面を減らす場合だけ採用する。
- `use(promise)` で TanStack Query の cache / retry / auth error normalization を迂回しない。
- React Compiler は、既存 lint / format / CI と compiler diagnostic を安定統合できるまで採用しない。

### 3.5 API Client

- web 型は `openapi-typescript` 生成の `shared/api/generated.ts` を使う。
- API DTO 変更後は `apps/api/openapi.yaml` と `apps/web/src/shared/api/generated.ts` を更新する。
- HTTP呼び出しは `shared/api/client.ts` を通す。credential、CSRF、Problem Details 正規化を feature で再実装しない。
- 横断 resource API は `shared/api/<resource>.ts`。feature 専用変換は feature 側に置く。
- JSON mutation retry は、同じ操作・同じ payload に同じ `Idempotency-Key` を再利用する。payload が変われば新しい key を発行する。
- 公開HTTP DTOへ内部画像path、旧OCR field名、旧dev header名を戻さない。残存検出は `apps/web/scripts/check-api-contract.mjs` へ寄せる。

## 4. OCR Worker

- worker は Python + uv で管理する。
- `momo_ocr/app` は起動・設定・logging、`momo_ocr/features` は機能単位、`momo_ocr/shared` は横断部品にする。
- OCR/画像解析に外部APIを使わない。
- OCR対象画面種別ごとに解析器を分け、共通前処理だけ共有する。
- 解析器は入力画像、画面種別判定、抽出結果、信頼度、警告、失敗理由を返せるようにする。
- OCRジョブ状態の正本はDB。Redis Streams は配送路。
- queue 契約は `docs/redis-streams-ocr-contract.md`、payload schema は `docs/schemas/*.schema.json` を正本にする。
- native OCR、Redis、PostgreSQL、tessdata を要する検証は integration marker へ分離する。unit test では parser、payload validation、状態遷移、failure mapping を優先する。

## 5. Runtime / Security / Ops

- Secrets、session ID、OAuth token、CSRF token、Redis URL、DB URL、画像内容、OCR raw text 全文をログに出さない。
- 例外ログは throwable の message / stack trace を直接出さず、例外クラス列などの安全な情報に絞る。
- 本番 `REDIS_URL` は原則 `rediss://` を必須にする。provider が TLS 非対応の内部接続として案内している場合だけ、明示設定付きで `redis://` を許可する。
- アップロード画像は PNG/JPEG/WebP、1枚3MBまで、OCR処理は最大4Kまで。形式、サイズ、寸法、実体を検証する。
- OCR元画像は下書き確定または下書き削除まで保持し、その後削除する。DBに画像実体、内部path、長寿命URLを保存・公開しない。
- ログイン、OAuth callback state、画像アップロード、JSON mutation、CSV/TSV出力にはレート制限を入れる。
- JSON mutation の retry replay は rate limit / key数上限で潰さず、新規 mutation だけ account 別 rate limit と未期限切れ `Idempotency-Key` 件数上限を適用する。上限値は `AppConfig` / env で管理する。
- Discord OAuth provider の `429` / `5xx` / transport error が続く場合は短期 backoff で provider 呼び出しを抑制し、UIが扱える Problem Details と安全なログイベントへ正規化する。
- `/healthz` はAPIプロセスの生存確認。DB/Redis接続確認は詳細ヘルスとして分ける。
- 本番ログは1行JSONにする。

runtime / deploy 変更では `Dockerfile`、`deploy/`、`.github/workflows/deploy.yml`、`scripts/ci/runtime-smoke.sh` を実装の現在状態として確認する。公開文書には判断ルールだけを残し、provider設定や攻撃面の詳細を写さない。
