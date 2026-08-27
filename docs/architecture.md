# アーキテクチャ規約

目的: API、Web、Processing Worker の責務と依存方向を判断する。現在の型、設定、payload、コマンドは実装を正本とし、この文書へ複製しない。

業務意味は `docs/domain-rule.md`、DB は `docs/db-rule.md`、OCR queue は `docs/redis-streams-ocr-contract.md`、戦績分析の横断要求は `docs/requirements/series-analysis-batch.md`、UI は `docs/ui-rule.md` を参照する。

## 1. System Boundaries

| 境界 | 責務 | 正本 |
| --- | --- | --- |
| Web | SPA、入力、表示、画面状態 | `apps/web/src/` |
| API | HTTP、認証、usecase、DB / queue adapter | Tapir endpoint、`apps/api/openapi.yaml`、`apps/api/` |
| Processing Worker | OCR / 分析の非同期実行、lease、外部I/O | `apps/processing-worker/` |
| DB | 業務状態、job、outbox、成果物 | `../momo-db` migration |
| Redis Streams | job の配送 | schema と queue 契約文書 |
| public HTTP runtime | Web 配信、API、reverse proxy | `Dockerfile`、`deploy/`、runtime tool |

- public HTTP runtime に OCR / 分析処理を同居させず、HTTP request 内で高負荷分析を実行しない。
- DB を状態の正本、Redis Streams を再配送可能な配送路とする。
- provider 固有値、resource 実測値、secret、運用手順は public docs に置かない。

## 2. API

### Wire Boundary

- HTTP 契約は Tapir endpoint を正本とし、生成 OpenAPI は Web 型生成入力として同期する。手書き route が必要でも path / query / header を二重管理しない。
- HTTP 層は入力・認証・エラー変換に閉じ、DB、Redis、業務分岐を直接持たない。
- raw ID、設定値、wire value は境界で検証済み型へ変換する。usecase へ未検証値や wire DTO を渡さない。
- optional field が mode や副作用を変える場合は discriminator として要件または domain 文書にも意味を残す。
- 外部依存は port と adapter で隔離し、composition root だけが実装を選ぶ。

### Usecase / Repository

- usecase は状態遷移、整合性、副作用を所有し、repository は永続化契約に閉じる。
- 通常制御フローは型で返し、予期しない不整合や外部I/O失敗と区別する。
- 部分更新は既存値と入力を合わせた実効状態で検証する。読み取り後の前提を更新に使う場合は、同じ更新条件で再検証する。
- in-memory adapter は production adapter と同じ状態遷移 guard を持つ。単純化した double を正本にしない。
- 分析読み取りは保存済み成果物を返すだけにし、関連する読み取りを同じ artifact version へ固定する。詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

### Transaction / Outbox

- 業務状態と outbox は同じ DB transaction で確定し、Redis publish は transaction の成功条件にしない。
- wake / publish は commit 後に実行する。rollback 時は post-commit effect を返さない。
- wake は業務 payload を持たない coalescing signal とし、永続 outbox row の代わりにしない。
- dispatcher は startup recovery、bounded drain、retry deadline、backoff を扱い、無条件の短周期 polling をしない。
- append 後の DB 更新失敗や重複配送を許容し、claim / fence と冪等な consumer で収束させる。

### Error / Auth

- 業務、認証、権限、入力、外部依存のエラーを区別し、UI が扱える Problem Details へ正規化する。
- OAuth provider、account、session、provider backoff は auth service に閉じる。HTTP module は cookie / redirect / wire 変換を担う。
- 認証主体と試合参加者を混同しない。状態変更 API は CSRF 対策を必須とし、dev/test 認証を本番経路へ混ぜない。
- UI が回復方法を変える HTTP status を汎用内部エラーへ潰さない。

## 3. Web

### Layering

- `apps/web/src` の依存方向は `app -> features -> shared` とする。逆方向 import と feature 間の実装詳細 import を禁止する。
- `shared` は横断 API、生成型の facade、query 基盤、共有 UI、共通 domain helper を所有する。画面固有の状態・変換・UI は feature に置く。
- Page は composition とページ状態に寄せ、取得、mutation、複雑な状態機械、純粋変換を分離する。
- 複雑な Page は feature 固有の PageModel から resource、command、location、feedback など画面の意味を受け取り、TanStack Query の result や mutation object を直接受け取らない。PageModel 内は lifecycle と変更理由が異なる関心事だけを hook / 純粋変換へ分け、単なる転送層は作らない。
- ファイル行数は責務混在を見つける signal とし、行数だけを理由に浅い module へ分割しない。
- import 境界など決定的に検査できる規則は `apps/web/scripts/` の checker に固定する。本番コードから test 専用 module を参照しない。

### Server State

- server state は TanStack Query の cache lifecycle に従い、Page/UI component から query 基盤を直接操作しない。
- query key は cache 内の runtime data shape まで区別する。backend resource が同じでも raw response と ViewModel を同じ key に置かない。
- fatal error、再取得、cached data、認証待ち、disabled query を別状態として扱う。mutation 後は表示中の resource と選択候補の cache をともに整合させる。
- 初回表示、mutation 後の cache 整合、artifact 失効時の bounded recovery、利用者が実行した更新 / 再試行だけが server state の取得を開始する。interval、遅延 timer、window focus、tab visibility、network reconnect を起点に自動再取得しない。この契約は共通 QueryClient と client data policy checker で固定する。
- React の concurrent / form API は cache、retry、認証、validation の既存契約を置き換えない範囲で使う。

### Form / React 19 / API Client

- event 由来の値は handler 内で同期的に取り出し、request transform で route / prefill / hidden identifier を落とさない。
- 分析の集計、意味を持つ sort / filter、閾値、統計 fallback は Web で再計算せず、保存済み成果物を表示用に整形する。

### API / UI Boundary

- Web の API 型は生成物を直接 feature へ漏らさず、`shared/api` の用途別 facade を介す。
- credential、CSRF、Problem Details、idempotency は共通 client で扱う。同一 mutation の retry は同じ操作 key を再利用し、payload が変われば新しい key にする。
- UI の意味表現と操作契約は `docs/ui-rule.md` を正本とし、shared UI と semantic token から外れる実装は checker で検出する。

## 4. Processing Worker

### Process Boundary

| 関心事 | parent process | attempt child process |
| --- | --- | --- |
| 外部I/O | DB、Redis、object storage、queue を所有 | 分析の read-only snapshot 以外を持たない |
| lifecycle | claim、lease / fence、spawn、制限、timeout、停止、reap | 1 attempt だけを実行する |
| 出力 | candidate を検証し、transaction で初めて確定する | bounded で非 authoritative な candidate を返す |
| 完了 | durable commit、post-commit effect、delivery disposition | job 終端、公開、ACK、outbox を変更しない |

- Analysis / OCR は同じ parent lifecycle を共有し、能力固有の入力 transport と計算だけを分ける。
- capability crate は決定論的な domain / 計算 / version 付き論理契約を所有し、DB、Redis、filesystem、clock、async runtime に依存しない。runtime から capability への一方向依存とする。
- production の OS FFI と `unsafe` は process adapter に隔離し、他 module へ checked な safe API を公開する。
- 子 process の resource 制限は実 runtime の cgroup で保証する。非対応 OS では job claim 前に fail closed にする。
- 同時実行や publication は DB lease と fencing token で世代をまたいで保証する。process 内 semaphore や台数を正本にしない。
- 子 process の成果物は上限、path、件数、schema、checksum を親が検証し、失敗時に部分公開しない。
- 入力 version、algorithm version、artifact schema version を別の型として扱い、同じ入力と algorithm version では決定論的にする。
- OCR だけが分析を preempt できる。共有実行枠、再queue、失敗回数、公開の詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

### OCR Capability / Worker Role

- OCR の object / queue / 状態契約は `docs/redis-streams-ocr-contract.md` と schema を正本とし、URL、credential、local path を runtime 間 payload にしない。

## 5. Runtime / Security

- secret、session / CSRF token、接続 URL、画像内容、OCR raw text、分析成果物本文をログへ出さない。例外は安全な分類情報へ正規化する。
- production の DB / Redis は暗号化と相手検証を維持し、接続のために認証要件を暗黙に弱めない。
- upload は許可形式、byte 数、寸法、内容 fingerprint を完全 decode 前後の境界で検証し、画像実体や長寿命 URL を DB / 公開 DTO に置かない。
- health、dependency readiness、機能応答、resource / performance を別の証拠として扱う。
- stream response は handler 完了ではなく転送終了時に success / error / cancel と byte 数を exactly once 観測する。
- runtime image は最小権限で動かし、診断手段を残す場合も provider 設定や攻撃面を public docs へ複製しない。
