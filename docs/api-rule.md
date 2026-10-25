# API 規約

目的: API の wire 境界、bootstrap と HTTP 実行、usecase / repository、transaction と wake、error / auth の実装契約を定める。HTTP 契約の現在値は Tapir endpoint、型・設定・上限値は実装と runtime 設定を正本とし、本書ではその正本を参照する。

依存方向は [アーキテクチャ](architecture.md#dependency-directions)、業務意味は [ドメイン規約](domain-rule.md)、DB の transaction・lock・gate・snapshot は [DB 規約](db-rule.md)、OCR job の受付は [OCR job 契約](ocr-job-contract.md)、分析の read と version は [分析 batch 要求](requirements/series-analysis-batch.md#6-api--web--admin)、エラー分類・CSRF・rate limit の非機能要求は [システム要求](requirements/system-design.md) を参照する。

## Wire Boundary

- HTTP 契約は Tapir endpoint を正本とする。手書き route が必要な場合も、path / query / header は Tapir endpoint だけで管理する。
- `apps/api/openapi.yaml` は内部 Web codegen 用の追跡する派生物であり、契約や公開 API documentation の正本ではない。差分は常に Tapir からの再生成で解消する。
- OpenAPI lint は構造整合性の証拠に留める。field の公開可否、認証、業務意味は endpoint、DTO、要求・domain 規約で決め、legacy 名や source 断片の文字列検査を契約にしない。
- 分析 artifact の raw response shape は、Rust 所有の artifact schema と API 所有の metadata projection を Tapir の named response へ合成して HTTP 契約とする。OpenAPI、Web 型、runtime validator はこの合成結果から生成し、派生物の shape もこの生成結果から得る。
- match-context の HTTP v3 は、保存時の source revision との一致を調べる同じ read snapshot から owner 属性を付加する。revision と owner を一つの値として運び、独立した表示名 hydrate とは分けて扱う。保存 payload の checksum・decode 後に付加し、構造・参加者参照・応答上限を検証する。保存 schema と HTTP 世代は分離し、分析値は Worker が保存した値をそのまま使う。
- 分析結果の分類・根拠は Worker が所有し、画面内の遷移先、リンク文言、固定の指標説明は Web が所有する。保存成果物は画面構造から独立させ、Web が分類から遷移先を決める。
- 実績の編集用 catalog と根拠は保存済みの最新状態を読み、閲覧用の達成集合・星・分子分母・点数は同一 artifact の作品単位 resource から読む。項目名・備考・管理時に保存した表示順は API の同じ read snapshot で hydrate し、計算 checksum の対象外とする。表示順だけの更新は再集計なしで保存し、作品内の全項目を含む順序 revision で競合を検出する。実績 resource は比較 scope の有無にかかわらず、0試合の作品を含めて提供する。
- 分析は現行の成果物契約と HTTP 経路だけを提供し、旧世代の decoder、互換用 route、旧形式からの補完は維持しない。仲間内向けのサービスとして、互換コードの維持負担を持たないためである。成果物形式の変更と、保存形式を変えない HTTP projection の変更の切替単位は [分析 batch 要求の Compatibility](requirements/series-analysis-batch.md#8-compatibility--release--rollback) に従う。
- optional field が mode や副作用を変える場合は discriminator として要件または domain 文書にも意味を残す。

### Request Limits and Resource Release

- request body のサイズ上限は HTTP method に関係なく適用し、Content-Length がない場合も読取 byte 数で制限する。decode 前に同時実行数を制限し、画像 upload と通常 mutation を分離する。満杯の場合は本文を受け取って待機する代わりに、直ちに再試行可能な応答を返す。
- 認証済み read と mutation 試行は別の入口 rate limit で制限する。mutation 試行は本文 decode 前に判定し、再送や CSRF 拒否も数える。新規処理用の mutation / upload / OCR 制限とは分け、通常の再試行に余裕を持たせる。冪等 replay は本文 hash 照合後に決め、再送は新規処理用の枠の対象外とする。本人情報取得・logout は通常 read / mutation と別の認証操作枠を持つ。
- JSON read の待機件数と時間を制限し、待機上限では再試行可能な応答を返す。JSON・画像・export の応答は転送終了まで同時実行枠を保持する。DB projection は全量取得に先立ち、件数・文字数・保存 JSON の byte 数を検証する。
- 応答を返す前の失敗・取消では HTTP 層が取得済みの枠を解放し、応答を返した後は body の解放 scope へ引き継ぐ。ログなどの body wrapper はその scope を通常の効果の後へ隠さず、本文開始前の送信失敗でも server が解放できる形を保つ。応答生成後の補助処理は、取消があっても応答の所有権を保つ。HEAD 応答でも本文に引き継いだ resource を解放する。
- HTTP/2 の frame、flow control、stream reset、GOAWAY は HTTP ライブラリに任せ、アプリケーションで接続全体の切断や未読本文の無制限 drain へ置き換えない。
- Tapir の server logic で発生した例外は外側の共通 error middleware へ伝え、共通の Problem Details と機密情報を除いた incident log に変換する。例外応答とログの生成はこの middleware に一元化する。mutation の結果不明時に保持する idempotency 予約は、この HTTP 変換より内側で確定する。

## Bootstrap / HTTP Execution

- PostgreSQL を通常 runtime の永続化境界とし、DB 設定の欠落を InMemory へ fallback させない。設定漏れで保存されない runtime が起動することを防ぐ。接続 pool、storage、cache、wake とその Resource は runtime が一度だけ生成・所有する。
- identity storage は起動時の read-only snapshot で legacy / canonical の完全な schema 契約を検証し、確定した mode を repository へ渡す。途中の移行状態を列の有無だけで受理しない。canonical の主キー・参照は UUID、既存 HTTP identity と principal は保存した exact legacy alias を使い、通常の参照入力は既存 row の alias / UUID lookup で解決する。保存 ID の契約と、切替完了後も続ける schema 検査は [DB 規約の Identifiers and Decoding](db-rule.md#identifiers-and-decoding) に従う。
- feature ごとの bootstrap が必要な repository / service から usecase を組み立て、HTTP module が所有する UseCases の束を中央で展開・再包装せずにそのまま渡す。個々の usecase の依存先は、受け取った必要な port に限る。責務分離を保ったまま、組み立てコードの重複を減らすための分担である。
- 共通 HTTP 入口は認可、replay、decode、usecase 実行、response 変換の接続だけを扱い、業務判断と transaction は usecase と repository が所有する。endpoint ごとの codec・実行関数・response の指定は composition として明示し、用途の異なる手順は別の composition として表す。
- 処理順は認証・認可、入力上限、replay、新規操作の受付・業務検証の意味から決める。既存の並び自体は互換契約として扱わず、保存済み idempotency key / fingerprint や有効な client 契約を変える場合だけ必要な移行を設ける。時計、ID、member / alias の読取りは bootstrap 時ではなく操作時に評価する。
- canonical でも旧 raw idempotency key の exact lookup と raw request hash の照合を先に行う。旧 key の replay は raw key の完全一致と本文の照合を満たす場合に限り、UUID として同値でも別表記なら競合として扱う。fresh key だけ UUID として受理する。本文内の既存参照は replay 判定後に解決し、旧・新 key の予約と合計 quota は同じ legacy account lock で直列化する。

## Usecase / Repository

- domain は不変条件、状態の優先順位、範囲判定、純粋な組み立てを所有する。usecase はそれらを使った手順と副作用を所有し、repository は必要な整合性を保証する永続化操作を公開する。SQL 行の型変換と I/O 失敗の扱いは adapter に置く。
- 読み取りは利用目的に合う projection を返す。開催詳細や export には、incident、OCR 来歴、監査情報を持つ全 `MatchRecord` の代わりに、必要な列・名称だけを同じ読み取り snapshot で取得する。snapshot の所有者は [DB 規約の Locks and Transactions](db-rule.md#locks-and-transactions) に従う。
- 一覧・詳細の表示名と開催日時は対象 row と同じ read snapshot へ含め、Web は全 master や先頭ページの開催一覧を結合して補う代わりにその値を使う。選択済み対象の確認は軽量な identity / summary だけを使う（試合結果・メモ・OCR 来歴は取得しない）。絞込み候補と対象の表示情報は用途を分ける。
- ページ一覧の表示名 JOIN は対象ページを確定した後に行う。開催一覧も転送は対象ページの scope に限り、全体件数は scalar 集計として同じ snapshot で読む。
- 下書き review は現在の下書き、参照中の OCR 結果、保持中の画像 descriptor を一つの snapshot として読む。世代の整合は API が保証し、画像本体は選択した descriptor から別途取得する。整合性は確定前の先行 GET ではなく、atomic な確定 command と競合 response を正本にして保証する。
- 元画像の取得は descriptor が指す画像 ID、ZIP 取得は下書きの更新時刻を前提条件にする。画像と OCR 結果は同じ世代どうしで組み合わせ、世代不一致は再確認を求める。未保存の入力へ新しい OCR 結果を自動で混入させない。
- ZIP は response body の評価 scope 内で生成し、一時ファイルや全量 buffer を HTTP 応答へ引き渡さない。事前に画像 metadata の合計サイズを検証し、生成中も実際の ZIP サイズを制限する。送信中の読取・生成失敗や上限超過は転送を中断し、Web は body 全体の取得成功後にだけファイル保存を開始する。
- 新しい read endpoint や必須 response 情報に Web を移すときは、API を先に配備する。旧 Web が使う有効な endpoint は移行期間中維持し、生成 client には有効な契約だけを残す（廃止済み route の固定 error 応答は除く）。
- DB 接続・pool 取得・SQL 実行・lock 待ちには有限の上限を設ける。transaction pooling でも制限を維持するため、SQL 側の上限は各 transaction で `SET LOCAL` を適用し、個別処理では必要に応じて短縮する。
- 下書きの変更・取消と OCR の受付・取消は、認証主体の所有権を usecase と原子的な保存操作で確認する。共同編集可能な確定済み試合の契約とは分ける。
- InMemory の役割は test source の限定した HTTP / application double に絞り、永続化契約の検証は実 PostgreSQL の adapter が担う。必要な状態条件は domain policy を使い、lock・rollback・制約・永続 job の意味は実 PostgreSQL で検証する。複雑な保存条件を必要とする test は実 DB へ移し、不要になった double と重複 test を削除する。
- 分析読み取りは保存済み成果物を返すだけにし、関連する読み取りを同じ artifact version へ固定する。詳細は [分析 batch 要求の Read API](requirements/series-analysis-batch.md#read-api) を正本とする。

## Transaction / Job Wake

- 業務状態と job / request / 入力は同じ DB transaction で確定し、transaction の成否は起床通知の成否から独立させる。原子的な command は一つの repository 操作として公開し、adapter 内で `ConnectionIO` を合成して一度だけ commit する。
- 下書き・試合の変更に伴う Discord 通知取消も同じ source command へ含める。transaction の集約単位と lock 順はアプリに明示し、通知 trigger で暗黙に補完しない。lock 順・gate の取得順・SAVEPOINT の規則は [DB 規約](db-rule.md#consumer-contract) を正本とする。
- 管理者の Discord 通知設定は API の application command として扱う。domain が世代競合と変更・取消対象を決め、PostgreSQL adapter が gate 取得、最新状態の読取り、設定と取消の一括保存を行う。DB は永続化と排他を担い、設定保存は Summit の稼働状態にかかわらず行える。
- wake は commit 後に実行し、post-commit effect は commit が成功した場合だけ返す。wake は業務 payload を持たない coalescing signal であり、仕事の正本は永続 job / request とする。
- API の commit 後 handoff は process-local wake までとし、外部通知の I/O は Resource が所有する coordinator で実行する。確定済み更新の応答は通知の遅延・失敗と独立して返し、再試行と停止は coordinator、通知喪失後の回収は Worker runtime が所有する（[Worker 規約](worker-rule.md#runtime--listener--shutdown)）。
- 手動再計算の idempotency は永続した operation を正本とし、同じ key の並行受付を直列化して対象を照合する。key は HTTP 予約の期限切れ後も最初の対象にだけ有効とする。
- 分析では API と release controller が durable request を保存し、Worker が campaign 展開・job 作成・実行を所有する。業務内容は通知ではなく DB の要求に置き、展開途中の要求も DB に残す。

## Error / Auth

- account、session、OAuth callback の判断は auth service に閉じ、Discord HTTP client と OAuth state 使用済み記録の永続化は adapter に置く。HTTP module は cookie / redirect / wire 変換だけを担い、認証の account 判定と callback の組み立ても auth service 側に保つ。
- OAuth state は署名対象の形式識別子・署名・期限・サイズを検証し、provider 呼出し前に DB で一回限りの使用を確定する。使用済み記録は hash と期限だけを保持し、有効期間中は API 再起動後も保ち、保存不能時は callback を中止する。旧形式の state は再ログインで作り直し、既存 session の形式と有効性は維持する。
- ロールと操作権限の意味、権限変更後の認可とセッション無効化は [基本要求の認証・権限](requirements/base.md#3-認証権限)、認証主体と試合参加者の区別と dev / test 主体の扱いは [ドメイン規約の Actors](domain-rule.md#actors) を正本とし、認可は操作ごとに server で判断する。
