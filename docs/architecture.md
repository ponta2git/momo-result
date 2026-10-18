# アーキテクチャ規約

目的: API、Web、Processing Worker の責務と依存方向を判断する。現在の型、設定、コマンドは実装、wire payload の shape / limit は対応する endpoint または schema を正本とし、この文書へ複製しない。

業務意味は `docs/domain-rule.md`、DB は `docs/db-rule.md`、OCR job は `docs/ocr-job-contract.md`、戦績分析の横断要求は `docs/requirements/series-analysis-batch.md`、UI は `docs/ui-rule.md` を参照する。

## 1. System Boundaries

| 境界 | 責務 | 正本 |
| --- | --- | --- |
| Web | SPA、入力、表示、画面状態 | `apps/web/src/` |
| API | HTTP、認証、usecase、DB adapter | Tapir endpoint、`apps/api/` |
| Processing Worker | OCR / 分析の非同期実行、lease、外部I/O | `apps/processing-worker/` |
| DB | 業務状態、session、OAuth state使用済み記録、job、入力、成果物 | `../momo-db` migration |
| public HTTP runtime | Web 配信、API、reverse proxy | `Dockerfile`、`deploy/`、runtime tool |

- public HTTP runtime に OCR / 分析処理を同居させず、HTTP request 内で高負荷分析を実行しない。
- DB を業務状態と永続 job の正本とし、Worker が既存 job を直接取得する。
- provider 固有値、resource 実測値、secret、運用手順は public docs に置かない。

### Storage / Resource Boundaries

- 業務ルール・再試行方針・集計状態の更新手順はアプリが所有する。DBにはFK、一意性、改変不能性、原子的な条件付き更新を残す。複数consumerの整合性やrollback互換を守るtriggerは、置換する契約と移行順が揃うまで削除しない。
- rate limitのカウンタはAPI process内で保持し、scopeごとのkey数と有効期間を制限する。process間では共有せず、再起動で初期化される。永続するquotaや同時job上限はDBの原子的な操作で別に守る。
- 接続poolはruntimeで再利用し、取得待ちの実行枠もpool上限へ合わせる。利用しない接続の常時補充やkeepalive queryを避ける一方、requestごとの接続開閉へ置き換えない。
- 受付判定は必要な外部状態の取得結果から行う。直前のPINGを成功保証とせず、外部状態をcacheしてquotaやfail-closedの意味を弱めない。
- 処理中のlease heartbeat、待機中のcapability更新、jobの起床通知、実行可能時刻、履歴保持は別の目的を持つ。閾値は相互の期限・shutdown予算・利用者の待ち時間と合わせて調整し、コマンド数やquery負荷だけで決めない。
- queryやindexの変更は、変更する負荷境界と未解決の疑問に応じて、通常件数・上限付近・上限超過の条件と、実行計画・転送量・buffer利用・応答時間から必要な証拠を選ぶ。測定には開発用data storeと分離した合成fixtureを使い、実験資源を破棄する。整合性とresource上限を守ったうえで単純さと保守負担も含めて採否を決め、接続数・コマンド数の削減をそのままproviderの稼働時間や請求額の削減と扱わない。

## 2. API

### Wire Boundary

- HTTP 契約は Tapir endpoint を正本とする。手書き route が必要でも path / query / header を二重管理しない。
- 分析artifactのraw response shapeは、Rust所有のartifact schemaとAPI所有のmetadata projectionをTapirのnamed responseへ合成してHTTP契約とする。OpenAPI、Web型、runtime validatorはこの合成結果から生成し、派生物へshapeを手書きしない。
- match-contextのHTTP v3は、保存時のsource revisionとの一致を調べる同じread snapshotからowner属性を付加する。revisionとownerを一つの値として運び、独立した表示名hydrateと混ぜない。保存payloadのchecksum・decode後に付加し、構造・参加者参照・応答上限を検証する。保存schemaとHTTP世代は分離し、APIで分析値を再計算しない。
- 分析結果の分類・根拠はWorkerが所有し、画面内の遷移先、リンク文言、固定の指標説明はWebが所有する。保存成果物へ画面構造を埋め込まず、Webは分類から遷移先を決める。
- `apps/api/openapi.yaml` は内部 Web codegen 用の追跡する派生物であり、契約や公開 API documentation の正本ではない。Tapir から一時生成した spec を保守された OpenAPI-aware linter で構造検証し、tracked artifact と一致させ、その artifact から Web 型を生成する。手編集で差分を解消しない。
- OpenAPI lint は unresolved reference、path / parameter、schema、operation identity など構造整合性に限定する。field の公開可否、認証、業務意味は endpoint、DTO、要求・domain 規約で決め、legacy 名や source 断片の文字列検査を契約にしない。
- HTTP 層は入力・認証・エラー変換に閉じ、DB操作、業務分岐を直接持たない。
- request body のサイズ上限はHTTP methodに関係なく適用し、Content-Lengthがない場合も読取byte数で制限する。decode 前に同時実行数を制限し、画像uploadと通常mutationを分離する。満杯の場合は本文を保持して待機せず再試行可能な応答を返す。
- 認証済みreadとmutation試行は別の入口rate limitで制限する。mutation試行は本文decode前に判定し、再送やCSRF拒否も数える。新規処理用のmutation / upload / OCR制限とは分け、通常の再試行に余裕を持たせる。冪等replayは本文hash照合後に決め、再送で新規処理用の枠を消費しない。本人情報取得・logoutは通常read / mutationと別の認証操作枠を持つ。
- JSON readの待機件数と時間を制限し、待機上限では再試行可能な応答を返す。JSON・画像・exportの応答は転送終了まで同時実行枠を保持する。DB projectionは全量取得後の検査に頼らず、件数・文字数・保存JSONのbyte数を転送前に検証する。
- 応答を返す前の失敗・取消ではHTTP層が取得済みの枠を解放し、応答を返した後はbodyの解放scopeへ引き継ぐ。ログなどのbody wrapperはそのscopeを通常の効果の後へ隠さず、本文開始前の送信失敗でもserverが解放できる形を保つ。応答生成後の補助処理は取消で応答の所有権を失わないようにする。
- HEAD応答はエラーを含めて本文を送らず、本文に引き継いだresourceも解放する。405応答のAllowは対象routeで許可するmethodから求める。HTTP/2のframe、flow control、stream reset、GOAWAYはHTTPライブラリが所有し、アプリケーションで接続全体の切断や未読本文の無制限drainへ置き換えない（[RFC 9110 §9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2)、[RFC 9113 §8.1](https://www.rfc-editor.org/rfc/rfc9113.html#section-8.1)）。
- Tapirのserver logicで発生した例外は外側の`HttpErrorMiddleware`へ伝え、共通のProblem Detailsと機密情報を除いたincident logに変換する。Tapirの既定例外応答・例外logと二重に処理しない。mutationの結果不明時に保持するidempotency予約は、このHTTP変換より内側で確定する。
- raw ID、設定値、wire value は境界で検証済み型へ変換する。usecase へ未検証値や wire DTO を渡さない。
- 分析は現行の成果物契約とHTTP経路だけを提供する。旧世代のdecoder、互換用route、旧形式からの補完は維持しない。成果物形式を変えるときはAPI・Web・Workerを揃え、必要な再計算を公開再開前に完了する。保存形式を変えないHTTP projectionの変更では対応API/Webを一体で切り替え、Worker変更・再計算を要求しない。
- optional field が mode や副作用を変える場合は discriminator として要件または domain 文書にも意味を残す。
- 依存方向は `http → auth / usecases → domain + ports / repositories`、`adapters → domain + ports / repositories` とする。外部通信・永続化の実装は adapter に置き、`bootstrap` だけが実装を選ぶ。認証の account 判定と callback の組み立ても HTTP module へ戻さない。
- 外部境界には利用側が必要とする操作・値だけを公開する。セッションには有効期間、OAuth state には署名鍵と有効期間、OCR受付には別名の snapshot を渡し、全体設定や未使用の更新操作を運搬しない。SDK client、SQL、provider wire DTO は adapter 内に閉じる。

### Bootstrap / HTTP execution

- PostgreSQL を通常 runtime の永続化境界とし、DB 設定の欠落を InMemory へ fallback させない。接続 pool、storage、cache、wake とその Resource は runtime が一度だけ生成・所有する。
- feature ごとの bootstrap が必要な repository / service から usecase を組み立て、HTTP module が所有する UseCases の束をそのまま渡す。中央で同じ一覧を展開・再包装しない。個々の usecase は必要な port だけを受け取り、runtime 全体の依存 container を参照しない。
- 共通 HTTP 入口は認可、replay、decode、usecase 実行、response 変換の接続を扱い、業務判断や transaction を所有しない。endpoint ごとの codec・実行関数・response の指定は composition として明示し、用途の異なる手順を切替 flag の組合せへ押し込まない。
- 処理順は認証・認可、入力上限、replay、新規操作の受付・業務検証の意味から決める。既存の並び自体を互換契約にせず、保存済み idempotency key / fingerprint や有効な client 契約を変える場合だけ必要な移行を設ける。時計、ID、member / alias の読取りは操作時に評価し、bootstrap で snapshot 化しない。

### Usecase / Repository

- domain は不変条件、状態の優先順位、範囲判定、純粋な組み立てを所有する。usecase はそれらを使った手順と副作用を所有し、repository は必要な整合性を保証する永続化操作を公開する。SQL行の型変換とI/O失敗の扱いはadapterに置く。
- 読み取りは利用目的に合う projection を返す。開催詳細や export のために incident、OCR来歴、監査情報を持つ全 `MatchRecord` を運搬せず、必要な列・名称だけを同じ読み取り snapshot で取得する。複数statementで一つの結果を組むPostgreSQLのreadはread-only / repeatable-readへ閉じ、writeに合成する `ConnectionIO` へread-only設定を埋め込まない。
- 一覧・詳細の表示名と開催日時は対象rowと同じread snapshotへ含め、Webが全masterや先頭ページの開催一覧を結合して補わない。選択済み対象の確認は軽量なidentity / summaryを使い、試合結果・メモ・OCR来歴を取得しない。絞込み候補と対象の表示情報は用途を分ける。
- ページ一覧の表示名JOINは対象ページを確定した後に行う。開催一覧もページ外のscopeを転送せず、全体件数はscalar集計として同じsnapshotで読む。ページングの前後で必要な条件・順序・cursorを変えない。
- 下書きreviewは現在の下書き、参照中のOCR結果、保持中の画像descriptorを一つのsnapshotとして読む。Webが複数responseの世代を突き合わせる責任を負わず、画像本体は選択したdescriptorから別途取得する。確定前の先行GETを整合性保証にせず、atomicな確定commandと競合responseを正本にする。
- 元画像の取得はdescriptorが指す画像ID、ZIP取得は下書きの更新時刻を前提条件にする。差替え後の別画像を古いOCR結果と組み合わせず、世代不一致は再確認を求める。未保存の入力へ新しいOCR結果を自動で混入させない。
- ZIPはresponse bodyの評価scope内で生成し、一時ファイルや全量bufferをHTTP応答へ引き渡さない。事前に画像metadataの合計サイズを検証し、生成中も実際のZIPサイズを制限する。送信中の読取・生成失敗や上限超過は転送を中断し、Webはbody全体の取得成功後にだけファイル保存を開始する。
- 新しいread endpointや必須response情報にWebを移すときは、APIを先に配備する。旧Webが使う有効なendpointは移行期間中維持し、廃止済みrouteの固定error応答を有効な契約として生成clientへ残さない。
- 集約結果だけが必要な一覧はDBで集約し、表示しない監査履歴を全件転送しない。DB内で完結するsnapshotの複製は `INSERT ... SELECT` で表し、JVMを経由するread/write往復を増やさない。整合性は境界のテストで確認し、query costに具体的な懸念があれば実行計画など必要な証拠を選ぶ。単純化は所有する責務と変更時の負担から判断する。
- DB接続・pool取得・SQL実行・lock待ちには有限の上限を設ける。transaction poolingでも制限を維持するため、SQL側の上限は各transactionで `SET LOCAL` を適用し、個別処理では必要に応じて短縮する。
- 通常制御フローは型で返し、予期しない不整合や外部I/O失敗と区別する。
- 部分更新は既存値と入力を合わせた実効状態で検証する。読み取り後の前提を更新に使う場合は、同じ更新条件で再検証する。
- 下書きの変更・取消とOCRの受付・取消は、認証主体の所有権をusecaseと原子的な保存操作で確認する。共同編集可能な確定済み試合の契約とは分ける。
- InMemory は test source の限定した HTTP / application double とし、第二の永続化実装として育てない。必要な状態条件は domain policy を使い、lock・rollback・制約・永続 job の意味は実 PostgreSQL で検証する。複雑な保存条件を必要とする test は実 DB へ移し、不要になった double と重複 test を削除する。
- 分析読み取りは保存済み成果物を返すだけにし、関連する読み取りを同じ artifact version へ固定する。詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

### Transaction / Job Wake

- 業務状態と job / request / 入力は同じ DB transaction で確定し、起床通知の成功を transaction の成功条件にしない。原子的なcommandは一つのrepository操作として公開し、adapter内で `ConnectionIO` を合成して一度だけcommitする。
- 下書き・試合の変更に伴うDiscord通知取消も同じsource commandへ含める。transactionの集約単位とlock順はアプリに明示し、通知triggerで暗黙に補完しない。詳細は`docs/db-rule.md`を参照する。
- 管理者のDiscord通知設定はAPIのapplication commandとして扱う。domainが世代競合と変更・取消対象を決め、PostgreSQL adapterがgate取得、最新状態の読取り、設定と取消の一括保存を行う。DBは永続化と排他を担い、Summitの稼働は設定保存の前提にしない。
- wake は commit 後に実行する。rollback 時は post-commit effect を返さない。
- wake は業務 payload を持たない coalescing signal とし、永続 job / request の代わりにしない。
- API の commit 後 handoff は process-local wake までとし、外部通知の I/O は Resource が所有する coordinator で実行する。通知の遅延・失敗で確定済み更新の応答を待たせず、再試行と停止は coordinator、通知喪失後の回収は Worker runtime が所有する。
- Worker runtime は起動・再接続時の走査、bounded drain、実行可能時刻、lease 回復、backoff を扱い、低頻度走査で通知欠落を補う。
- 候補選択と実行権取得を分け、claim / fence で複数親の競合と古い owner の更新を制御する。
- 手動再計算のidempotencyは永続したoperationを正本とし、同じkeyの並行受付を直列化して対象を照合する。HTTP予約の期限切れ後も別対象へのkey流用を受理しない。
- 分析では API と release controller が durable request を保存し、Worker が campaign 展開・job 作成・実行を所有する。通知に業務 payload を持たせず、展開途中の要求は DB に残す。
- PostgreSQLのsession stateへ依存するworker listenerは、通常query用のtransaction-pooled接続と設定を分離したsession-capable接続を所有する。workerは別接続からの通知round tripをstartup readiness前に確認し、`LISTEN`文の成功だけを機能成立と扱わない。

### Error / Auth

- 業務、認証、権限、入力、外部依存のエラーを区別し、UI が扱える Problem Details へ正規化する。
- account、session、OAuth callbackの判断はauth serviceに閉じ、Discord HTTP clientとOAuth state使用済み記録の永続化はadapterに置く。HTTP moduleはcookie / redirect / wire変換を担う。
- 認証主体と試合参加者を混同しない。状態変更 API は CSRF 対策を必須とし、dev/test 認証を本番経路へ混ぜない。
- 認証cookieは形式と重複を検証してから扱い、API応答は共有cacheへ保存しない。OAuth stateは署名対象の形式識別子・署名・期限・サイズを検証し、provider呼出し前にDBで一回限りの使用を確定する。使用済み記録はhashと期限だけを保持し、有効期間中はAPI再起動で失わず、保存不能時はcallbackを進めない。旧形式のstateは再ログインで作り直し、既存sessionの形式と有効性は維持する。
- UI が回復方法を変える HTTP status を汎用内部エラーへ潰さない。

## 3. Web

### Layering

- `apps/web/src` の依存方向は `app -> features -> shared` とする。逆方向 import と feature 間の実装詳細 import を禁止する。
- `shared` は横断 API、生成型の facade、query 基盤、共有 UI、共通 domain helper を所有する。画面固有の状態・変換・UI は feature に置く。
- `shared` 内も依存方向を持つ。下表の基盤から業務別の adapter へ逆依存しない。型だけの import も同じ境界で扱う。

  | モジュール | 所有する判断 | 依存できる shared 基盤 |
  | --- | --- | --- |
  | `lib` | 業務に依存しない値変換・局所的な React / browser utility | `lib` |
  | `domain` | 業務語彙、identity、入力順、純粋な変換 | `domain`、`lib` |
  | `api` | HTTP、wire decode、query key / cache、idempotency | `api`、`domain`、`lib` |
  | `ui` | 汎用の構造・操作・アクセシビリティ・表示補間 | `ui`、`lib` |

  `shared/matches`、`heldEvents`、`masters`、`navigation` などの業務別 module はこれらを組み合わせる。順位・メンバー identity を知る結果台帳は `shared/matches`、API の候補を選択部品へ接続する処理は `shared/heldEvents`、分析専用チャートは `features/seriesComparison` が所有する。配置名が shared であることを汎用性の根拠にしない。
- すべての feature で、入口が処理の流れを組み立て、純粋な model が判断・変換を、owner が状態・入出力・寿命を、UI が表示と利用者の操作を担当する。規模によって変えるのは分割量であり、この責務分担ではない。
- 画面の合成 hook は選択、整合した表示結果、編集、保存などの owner を組み合わせ、画面全体に必要な値だけを購読する。各表示領域は必要な readonly view と意味のある操作を受け取り、Query result、mutation object、内部 session、任意 updater、業務状態を書き換える ref を受け取らない。小さい機能は同じファイルの名前付き関数で分けてよく、同じ数・名前の層を全機能へ追加しない。
- 入力の正規化、選択の遷移、初期化、取得・保存可否、結果の採用、表示への変換は、値を受けて結果を返す純粋な model で読めるようにする。URL の読み書き、query、保存、時刻の取得と状態への反映は対応する owner が扱う。同じ更新を複数の setter / effect へ分散させない。未解決・利用不可・利用可能など意味の異なる結果を型で区別し、通信中かどうかは別に扱う。外部入力や応答の対象・世代の一致は実行時にも検証する。
- 最新状態の読取り、純粋な遷移・実行判断、commit と入出力への接続は、対象の状態を所有する境界に閉じる。一緒に整合を守る入力・確認状態は一度に更新し、独立した取得・送信・表示資源まで一つの owner に集めない。owner の寿命と購読範囲は別に決め、表示を分割しても進行中の操作や編集の所有期間を短くしない。
- 戦績比較は URL を確定した選択の正本とし、要求中・確認済み・表示中の条件を区別する。選択は候補との整合と URL 更新、結果は取得した成果物の採用と表示、見通しセッションは採用済み要約と試算入力をそれぞれ所有する。試合一覧の更新も対象付きの読取結果を選択へ渡し、取得処理から URL を直接変更しない。
- hook が計算済みの値を別の builder へ渡し、そのまま同じ画面モデルへ詰め直す層は置かない。子の契約は使用する値・操作だけで表し、設定欄へ全 player 入力、チャートへ全 artifact、command へ全 page model を運ばない。純粋な表示変換・型は hook や page component へ依存せず、consumer と取得処理の共通の下位に置く。
- ファイル行数は責務混在を見つける signal とし、行数だけを理由に浅い module へ分割しない。
- 本節を依存方向の正本とする。静的 gate へ投影する場合は `docs/dev-rule.md` の採用基準に従い、module graph から判定できる import 規則だけを syntax-aware な tool で検査する。本番コードから test 専用 module を参照しない。

### Build / Test Tooling

- `apps/web/scripts` は API / Web のローカル起動、Web の生成・build 検査・隔離 E2E 起動を所有する Node の開発用境界であり、`src` の実行層ではない。production は生成された型・validator を消費し、script や E2E fixture を import しない。
- API 生成は Tapir 由来 OpenAPI から型、resource 別の遅延読込 registry、CSP 下で実行できる事前コンパイル済み validator をまとめて導出する。途中の schema は生成処理内に閉じ、consumer のない中間ファイルを追跡しない。
- build checker は最終 CSS に必要な global theme と参照先が残ることを確認する。CSS cascade や実際の paint の証拠とは区別する。
- `apps/web/scripts/e2e` の入口は各 run の資源と後片付けを所有し、共通 runtime は隔離した子 process 環境と service の起動を所有する。`apps/web/scripts/process.mts` の子 process 起動・中断・終了待ちをローカル開発と共有し、開発用 env の読取りは `dev-local.mts` に閉じる。入口をライブラリとして import せず、import だけでは Docker 設定や process の状態を変えない。OCR 専用の制御 worker・通知 recorder・画像 fixture は通常 E2E の前提にしない。

### Server State

- server state は TanStack Query の cache lifecycle に従い、Page/UI component から query 基盤を直接操作しない。
- 取得・保存担当の公開契約は用途別の data、取得・操作状態、結果、操作に絞る。Query result、mutation object、QueryClient、query key、再取得 options を業務判断や編集状態へ渡さない。キャッシュ通知・更新・破棄と再取得の実装は取得・保存 adapter に閉じ、認可の所有期間、結果の採用、競合解消などの判断はその契約を通して行う。同じファイルの名前付き関数でも境界は表せるため、endpoint ごとの中継や Query API を写した汎用 wrapper は増やさない。
- 結果確認の元画像も、取得状態とBlobをTanStack Queryが所有する。画像一覧と画像本体は異なるquery keyを持ち、本体は認証主体・画面scope・下書き・画像descriptorの世代を区別する。Object URLは画面の表示資源として生成・解放し、Blobや取得状態を別のcacheへ複製しない。
- 元画像の先読みは初回表示または利用者の画像選択に続く有限の処理として許可する。featureの取得処理が表示対象を優先して直列化し、同一取得の引継ぎ、中断、容量、scope終了時のquery破棄を所有する。自動retryや回線復帰による取得再開を起こさず、確定・削除成功時は関連cacheの更新より先に画像の寿命を閉じる。
- query key は cache 内の runtime data shape まで区別する。backend resource が同じでも raw response と ViewModel を同じ key に置かない。
- 対象の確定した不存在を再取得中も保持する read は、domain の `404 / NOT_FOUND` を read-result として扱い、raw response と異なる key に置く。一時的な通信失敗や一般的な HTTP 404 を不存在へ変換しない。mutation 後の cache 整合は両方の key を対象にし、以前の成功表示や候補一覧から不存在を巻き戻さない。
- masterの管理と入力候補は同じraw responseを共有し、並べ替えを`select`へ閉じる。設定管理は現在の権限で許可された訪問済みtabに必要なqueryだけを有効にし、変更responseをcacheへ反映してから表示名を含む関連readを無効化する。再取得失敗で確定した追加・訂正・削除を巻き戻さない。
- consumer の射影は `select` または純粋な表示変換で行い、cache は元の server data を保持する。表示中の data が現 query の値か前 scope の placeholder かは query observer の状態から判断し、その判定のために描画時に cache を別途読み直さない。
- fatal error、再取得、cached data、認証待ち、disabled query を別状態として扱う。mutation 後は表示中の resource と選択候補の cache をともに整合させる。
- Webの本人情報はauth queryを正本とし、管理機能の表示・query・明示refetch・送信直前のcommandを`shared/auth`の共通の許可判断へ接続する。再確認の進行と操作の所有期間も同じ境界で扱い、一時失敗中に旧roleだけで操作を再開しない。
- 確定失権した管理readはcancelしてcacheを除去する。管理者権限だけの喪失ではアカウント・通知、運用権限も失った場合は分析管理・レーダーを対象にし、通常のmaster・分析結果等の共有参照は保持する。主体と許可の所有期間が変わった後の応答で保護cacheや新しい入力を復活・上書きせず、再付与を古い操作の継続と扱わない。同一主体が参照できるmasterの確定mutation結果の反映と、保護refetch・画面の完了処理を分ける。
- 管理用query/commandの権限拒否は一度の本人情報再確認へ集約し、処理済み・旧作業の拒否を起点に循環させない。本人情報と保護queryの401/403は自動retryせず、許可継続後も拒否されたreadの再試行は利用者の操作に任せる。再確認・再表示でPOSTを再送せず、確認中に到着した受付結果は既存mutationのownerに保持する。
- 初回表示、mutation 後の cache 整合、artifact 失効時の bounded recovery、利用者が実行した更新 / 再試行だけが server state の取得を開始する。interval、遅延 timer、window focus、tab visibility、network reconnect を起点に自動再取得しない。この契約は共通 QueryClient に集約し、feature ごとに再実装しない。
- レーダー基準の作成・復元は、利用者が開始して受付が確定した操作に限り、待機表示から編集へ進むために完了状態を自動確認する。対象はその操作だけとし、完了・失敗・読取エラー・権限停止で止め、非表示ブラウザでは継続取得しない。読取失敗の再開は明示更新で行い、POSTを再送しない。通常の管理状態取得や手入力の正式比較には適用しない。
- 分析の計算payloadがimmutableでも、現在の名称や試合revisionに依存するHTTP projectionは可変として扱う。master変更は表示名を含むartifact response、試合訂正・削除はその試合のcontextとidentityを更新する。手動更新はstatusで参照世代を確定してから必要なresourceを読み、新旧artifactを同時に再取得しない。
- match-contextの確定した不存在・失効は成功済みcacheの利用を止め、一時的な更新失敗と区別する。比較画面と試合結果画面で共通の利用判定を使い、表示bundleの選択試合と全マーカーを揃える。再取得中の復活を含む状態契約は[分析横断要求](requirements/series-analysis-batch.md#web-state)を正本とする。
- React の concurrent / form API は cache、retry、認証、validation の既存契約を置き換えない範囲で使う。

### React 更新の優先度

- 入力値、選択 intent、focus は即時に反映する。`useDeferredValue` は追従を遅らせてもよい検証表示・一覧・図表に使い、送信時の validation と request は最新値から同期的に組み立てる。
- 入力や処理状況の購読は、それを表示する領域へ置く。独立した表示が一つの編集状態を共有するときは、必要に応じて画面寿命の store と用途別 snapshot を使い、変更のない view の参照を保つ。単独の入力・dialog は局所 state のままとし、Query の server data を別 store に複製しない。性能は必要な経路の観測で判断し、store・selector・memo を全機能へ一律に追加しない。
- 遅延する表示は `memo` と安定した props の境界を組み合わせ、urgent render で前の重い subtree を再描画しない。小さい値の加工へ一律に memo を足さず、state の局所化・不要な依存の削減を先に検討する。deferred value は debounce、通信回数の制限、計算量の削減ではない。
- 表示 bundle を遅延する場合は data、scope、view の identity を一緒に保つ。要求中の条件を古い図表の見出し・操作へ混ぜず、追従中の表示と操作制限は既存の stale 表示へ接続する。
- `useOptimistic` の更新は Action 内で行い、操作に属する非同期処理を await する。navigation の Promise は Router の完了境界であり、任意の `React.lazy` subtree の描画完了を保証しない。取得は Query、code readiness は Suspense が引き続き所有する。
- 作成結果を楽観表示する場合、成功 response を Query cache の確定値へ引き継いでから再取得する。再取得だけに確定を任せず、保存成功後の再取得失敗を作成失敗へ巻き戻さない。失敗した Action は入力を残し、成功時だけ明示的に初期化する。

| 対象 | 採用する更新境界 | 理由 |
| --- | --- | --- |
| 試合一覧の条件変更 | 即時の選択 intent、遅延した一覧、古い対象への操作制限 | 続けて条件を変えながら表示を追従させる |
| 戦績比較の view / scope / artifact | 整合した表示 bundle の遅延、図表の memo 境界 | 大きい図表更新を選択操作と分離する |
| 試合入力 | workspace が所有する数値文字列、遅延検証、cell 単位の draft 射影 | 表示幅・入力欄の開閉でも未完成の入力を維持し、無関係な cell の描画を抑える |
| マスタ作成 | Action と局所的な楽観行、成功 response の確定反映 | 待ち時間中も追加を示し、失敗時に入力を回復する |
| 保存・削除・OCR開始・権限/通知変更・再計算・出力 | Action / mutation の pending と確定結果 | 検証、競合、副作用、生成結果を先取りしない |
| 開催一覧・出力候補のページ取得 | Query の前ページ保持と scope 表示 | ページ単位の取得は既存の待機境界で扱える |

設定管理の訪問済み panel は、現在も許可される範囲で Base UI の `keepMounted` により入力・DOM を保持する。管理権限の再確認では画面とdialogの表示・操作を一時停止し、非制御入力と進行中commandのownerを保つ。確定失権したpanel・dialog・入力は終了し、許可が残る操作の入力やpending保護まで一律に破棄しない。

API の判断は React の [useDeferredValue](https://react.dev/reference/react/useDeferredValue)、[useTransition](https://react.dev/reference/react/useTransition)、[useOptimistic](https://react.dev/reference/react/useOptimistic) と TanStack Query の [mutation response による更新](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses) を参照する。効果は不要な render の削減と待機中の操作で確認し、通信速度や処理時間の短縮とは区別する。

### Client Lifecycle / Suspense / Motion

状態と表示補間の正本を次のように分離する。Motion は状態の視覚的な投影であり、application lifecycle の owner ではない。

| 関心事 | owner |
| --- | --- |
| server data、cache、refetch | TanStack Query |
| 楽観表示 | React `useOptimistic` または TanStack Query の mutation / cache のいずれか一方 |
| pending | Action、Transition、mutation など、その処理を開始した lifecycle |
| 操作と結果の通知単位・発火、inline feedback の継続条件 | 操作を所有する feature。表示先の選択は UI 規約に従う |
| 通知の描画・読み上げ、toast の表示寿命 | shared UI。画面をまたぐ toast は app に置く共通 host |
| pathname、search params、navigation | React Router |
| dialog / disclosure / select の open、focus、keyboard | Base UI と owning shared UI primitive |
| DOM / SVG の補間、非対話的な exit snapshot | Motion |

- 同じ楽観表示を React `useOptimistic` と TanStack Query cache の両方で表現しない。一つの表示箇所だけなら action / mutation の入力から局所 overlay を導出し、複数 consumer の server state を揃える必要がある場合だけ cache update と snapshot / rollback を使う。pending から server response へ同じ対象を引き継ぐ場合は、client で安定した identity を発行し、表示順や Motion の layout identity を data identity の代わりにしない。
- 表示準備、操作制限、通知は別の境界として設計する。表示準備は未準備な code / data と置換する body、操作制限は処理中の重複・競合操作、権限・前提条件、表示中と要求中の scope の違いから誤操作を招く範囲、通知は一つの利用者操作とその結果を成立させる取得のまとまりを扱う。query や親子 component ごとに同じ待機表示を生成せず、feature composition が既存の取得・操作状態から表示担当を導出する。通知の集約を理由に query を結合したり、独立した結果・失敗を一つの global pending に潰したりしない。
- Suspense は code / data readiness と fallback の presence を所有し、boundary は利用者に見せる loading sequence に合わせる。一度表示した dialog、tab list、toolbar、page surface の lifecycle を、その内部の body の待機から分離する。Suspense を使う場合は維持する部分を該当 boundary の外に置き、未準備な body だけを fallback と置き換える。最初の route module 自体が未準備な場合は route の structural fallback を使う。Motion や `AnimatePresence` で fallback と完成内容を crossfade せず、同じ primitive を loading 用と完成用に重複 mount して open / focus lifecycle を作り直さない。
- 異なる pathname は新しい route identity として、未準備なら route の structural fallback を表示する。同一 pathname の query key、filter、scope、sort、page の変更では、通常 query、Transition、deferred value など所有する state layer の手段で既存内容を維持し、Motion に待機や切替を決めさせない。
- 通常 query と Suspense query は、前条件の data 保持、部分失敗、独立した回復、安定した操作領域をどちらが簡潔に表現できるかで選ぶ。Suspense 採用を refetch 中の fallback 表示と同一視しない。待機表示の整理だけを理由に取得方式を置き換えず、boundary や content の identity を pending の切替で作り直さない。
- toast は feature が確定した実行結果から発火し、render、汎用 query observer、cache invalidation ごとの成功通知にしない。通常の route content の境界から共通 host を分離し、rendererはhostと同期で準備する。最初の通知から同じ描画経路を使い、準備用表示との交換で見た目・focus・表示寿命を作り直さない。通知の一意性は実行結果に結び付け、server state や操作の完了判定を toast の状態に移さない。
- 有限で局所的な motion の標準実装は Motion for React とする。app の一つの provider で同期 `LazyMotion`、animation と renderer だけを含む `domMin`、`strict`、`m` component を構成する。provider が `prefers-reduced-motion` を購読し、変更を `MotionConfig` と描画済みの末端 component へ反映する。`motion` component、`domAnimation` / `domMax` の gesture feature、layout / shared layout、drag / pan は初期 scope に含めず、必要性、操作契約、bundle 差分、主要 device の実測を伴う別の architecture decision とする。
- 面のhoverはshared UIの`useSurfaceFeedback`がnative DOMのpointer進入・離脱・cancelを観測し、Motion `animate`で内部のhover量だけを補間する。CSSは意味に対応した色対と、pressed・focus・操作制限の即時表示を所有する。click、keyboard、選択、openをこの接続で再実装しない。Motionのhover gestureは押下中のleaveを遅らせるため、この用途では使わず、`domMin`を維持する。有限CSS transitionの例外は設けない。外部refの接続・cleanupと動きを減らす設定の変更も接続側が扱い、画面へ時間・色・hover状態を公開しない。
- Motion の宣言は、変化する pixel と semantic state を所有する shared UI primitive または feature の末端 visual component に置く。画面の合成 hook、resource / command / query hook、router は Motion を import しない。`Fade`、`Slide`、`Scale` のように effect 名だけを隠す pass-through wrapper は作らず、複数用途の accessibility、state mapping、interruption を一つの小さい契約で隠せる場合だけ shared abstraction にする。
- application code は Motion の完了 callback を、data、cache、route、open、focus、pending、error、操作可能性を進める唯一の条件にしない。callback が所有してよいのは、中断または未実行でも application state を誤らせない冪等な表示上の後始末に限る。exit のため一時保持する node は非対話的かつ accessibility tree の対象外とし、先に確定した state と focus を巻き戻さない。
- presence による一時保持は、shared dialog と toast が通常の close / remove 後に非対話的な exit snapshot を描く場合だけ許可する。親 subtree、route、artifact、view の identity が失われた場合は exit を省略してよく、表示補間のためにそれらの lifecycle を遅らせない。
- 処理時間が不定な Spinner / Skeleton の loop だけは shared loading primitive 内の CSS を使ってよい。それ以外の新しい有限 motion は Motion に統一し、同じ transition に CSS、timer、Web Animations API、別の motion engine を混ぜない。Motion 導入時は既存の有限 CSS transition もこの境界へ移し、CSS loop の feature 直書きを shared loading primitive へ集約する。
- `MotionConfig` が transform / layout を無効にしても opacity や color は残り得るため、非必須の残存 motion は末端 component でも省略する。Motion の初回導入と feature bundle の変更では production build の bundle 差分を測る。使用 API と import 境界は、標準 lint で一意に判定できる範囲だけを静的検査へ投影する。

### Form / React 19 / API Client

- event 由来の値は handler 内で同期的に取り出し、request transform で route / prefill / hidden identifier を落とさない。
- 入力の owner は認証主体と作業対象で区切る。同じ作業の補助 query 変更では保持し、別の試合・draft・sample へ持ち越さない。未完成の数値文字列も入力に含め、validation と request は同じ最新値の射影を使う。一時保存の schema は、完成済み request の制約と分離して入力途中の値を保持する。設定への移動前は既存の保存処理の成功を確認し、ブラウザーの戻るでも同じ主体・作業・元データに限って復元する。roleを作業や保存のidentityに加えない。
- 編集可能になった最初の snapshot で入力を初期化し、同じ作業の再取得で入力を上書きしない。OCR の入力値・根拠・元画像 descriptor は同じ世代に固定し、世代変更時には再確認を案内する。保存中は送信対象の編集と離脱を保護し、完了前に遮断した離脱操作を完了後に自動再開しない。
- navigation、feedback、browser download など画面に属する非同期の完了処理は、開始時の route / 対象 / 最新 intent に対応する場合だけ行う。所有者の commit 境界で古い処理を無効にし、中断可能な read は中断する。確定 mutation の cache 整合は画面に属する副作用と分ける。
- 分析の集計、意味を持つ sort / filter、閾値、統計 fallback は Web で再計算せず、保存済み成果物を表示用に整形する。
- OCR の開始確認では設定・画像と送信する作品ヒントを同じ snapshot に固定する。API がジョブ受付時に既定のプレーヤー別名と登録済み別名をsnapshot化し、payload 上限を検証する。作品方式ごとの CPU 名の既定値と認識時の名前照合は Worker が所有し、明示した CPU 名を優先する。Web はそのための別名取得・正規化・上限処理を持たない。既存 OCR 結果から編集フォームを復元する名前解決は、入力支援として Web に残す。
- OCR送信の再試行は日時、下書きID、upload済み画像ID、idempotency keyを同じintent内で保持する。応答消失を未受付と推測して下書きを取消したり、新しい画像・下書きを作り直したりしない。送信前の不備と確定した受付拒否は入力修正へ戻せるようにし、受理不明の再送と区別する。

### API / UI Boundary

- Web の API 型は生成物を直接 feature へ漏らさず、`shared/api` の用途別 facade を介す。
- credential、CSRF、Problem Details、idempotency は共通 client で扱う。同一 mutation の retry は同じ操作 key を再利用し、payload が変われば新しい key にする。
- UI の意味表現と操作契約は `docs/ui-rule.md` を正本とする。shared UI と semantic token から外れる実装は、利用者に現れる意味・状態・操作への影響で review し、source 表記だけを一律の適合判定にしない。

## 4. Processing Worker

### Process Boundary

| 関心事 | parent process | attempt child process |
| --- | --- | --- |
| 外部I/O | DB、object storage、通知を所有 | 分析の read-only snapshot 以外を持たない |
| lifecycle | claim、lease / fence、spawn、制限、timeout、停止、reap | 1 attempt だけを実行する |
| 出力 | candidate を検証し、transaction で初めて確定する | bounded で非 authoritative な candidate を返す |
| 完了 | durable commit、post-commit effect、slot 解放 | job 終端、公開、要求を変更しない |

- Analysis / OCR は同じ parent lifecycle を共有し、種類固有の入力、claim、状態遷移、計算を分ける。
- `worker` の単一runtimeが構成、共通preflight、moduleのbootstrap、job選択、所有taskの監視と停止を管理する。独立したsupervisorとschedulerのrun loopは置かない。停止・業務側の回復不能な異常を検知した時点で新規claimと調停stepの開始を止め、一つの絶対期限で終了する。通常の確定処理の予算に強制停止・回収確認の猶予を加え、同じ期限内に予約する。DB処理中も停止・task異常を監視し、進行中のtransactionは通常のwakeで破棄しない。
- 停止signal・回収handle・最初の異常原因は、起動・通常運転のFutureが捕捉可能なpanicで失われても保持する。panicの捕捉は終了処理へ移るために使い、失われた業務状態を再利用して通常運転へ戻らない。後始末の成功で業務異常を成功扱いにせず、二次的な失敗で最初の原因や停止期限を上書きしない。commit成否不明の仕事は推測で確定せず、DBのlease・fenceと次回起動時の復旧に委ねる。
- 共通listener taskはjobと有効なOCR受付のpayload-free routeを同じ接続で購読し、各routeの初回round tripを確認してから発見処理へ進む。初回の購読・疎通確認の失敗は起動失敗とし、両routeは一つの再確認signalへまとめる。稼働後の一時切断は停止可能な局所再接続と疎通確認後の補完走査で回復し、protocol違反・panic・内部経路の予期しない破損はworker全体の停止へ進める。再接続中もlistenerは一世代だけとし、通常停止によるchannel終了を異常と混同しない。汎用PostgreSQL接続層へ業務やschedulerの知識を持ち込まない。
- 親の非同期実行はcurrent-thread runtimeを使う。bootstrapと資源を保持するmodule stateは独立taskではない。taskの分離は専用threadやprocessの隔離ではなく、OOM・process abort・同期ハング・終了処理自体のpanicでgracefulな完了を保証しない。
- 計算attemptは種類ごとの型付きRunnerで実行し、停止・終了・子と補助taskの回収は共通の実行管理handleで監視する。通常のErrでもRunner資源を返してtaskのpanicと区別し、完了待ちが中断されても回収の所有権を失わない。実行の正常終了と成果物公開の成功を同一視しない。業務固有のclaimや成果物を共通handleへ持ち込まず、回収未確認の資源や実行枠を次のattemptへ渡さない。
- moduleのbootstrapは接続・capability・入力前提を整え、未完了仕事も通常運転の有限な発見・実行経路へ渡す。全件列挙や全受付の終端を起動条件にしない。取得済みの資源はbootstrap全体の成功前から回収可能にし、登録済みcapabilityは後続の起動失敗時にもdrainingへ移す。分析のmodule stateはwork準備・保守・drainingと再利用資源を所有し、Runnerはclaim済みattemptに絞る。実行中も後続workの準備を進め、attempt間に履歴と一時領域を整理する。起動時に残った一時領域の再確認期限も通常運転へ引き継ぐ。
- 分析のterminal履歴と未参照artifactの保持・整理はWorkerのcontrol処理が所有し、APIの起動に依存しない。保持条件は分析batch要求を正本とし、公開済みcurrent / previousの保護とbounded cleanupを同じDB境界で保証する。
- capability crate は決定論的な domain / 計算 / version 付き論理契約を所有し、DB、filesystem、clock、async runtime に依存しない。runtime から capability への一方向依存とする。
- 通知基盤の `momo-notifications` は件数・bytesの予約、envelopeのserialize、呼出側transactionによる最終JSONBサイズ検証、transport設定の検証とHTTP送信を所有する。通知内容を作るproducer、業務SQL、DB接続、SAVEPOINTとcommit、環境変数の読取り、senderの監督・停止期限はworkerが所有する。workerから通知基盤への一方向依存とする。
- production の OS FFI と `unsafe` は process adapter に隔離し、他 module へ checked な safe API を公開する。TERM・KILL・process groupの回収は共通化し、分析の入力設定・終了分類とOCRのframe・結果decodeは各capabilityのprocess adapterに残す。
- instance の CPU・memory 予算は一つの attempt 全体に予約し、同時実行数は 1 に固定する。予約は claim 前に取得し、claim が成立しなかったと確認できた場合、または子 process と補助 task の回収確認後にだけ返す。lease 失効、timeout、Future の破棄だけでは次の計算を許可しない。将来の子 task も同じ予算を使い、task 分割によって同時実行数を増やさない。
- 子 process tree の CPU bandwidth と hard memory limit は実 runtime の cgroup で保証する。CPU 予算は `MOMO_PROCESSING_CPU_LIMIT_MILLIS`（既定 1000 millicpus）で指定し、runtime の CPU 割当を超える構成は拒否する。memory は child limit と親用 headroom の合計を runtime budget 内に収める。開始 barrier を開く前に両 controller への所属と制限値を読み戻し、v1 の別 hierarchy も両方が空になるまで回収を続ける。非対応 OS や未検証の制限は job claim 前に fail closed にする。
- 同時実行や publication は DB lease と fencing token で世代をまたいで保証する。process 内 semaphore や台数を正本にしない。
- 候補走査のsoftな時間予算は一回の処理量を区切る目安とし、候補取得だけで予算を使い切っても候補があれば少なくとも一件を試みる。続きはcursorと次回期限へ引き継ぐ。停止要求、SQLの上限、lease・fenceなどの実行権の条件を緩める理由にはしない。
- Busy後の早期再確認はconsumerごとの共有予算で回数・開始期限・同時数を制限し、新しい配送や再接続で予算を作り直さない。上限到達時は元の回復・保守期限へ戻す。開始済みclaimの確定とpost-commit effectを処理してから次の候補へ進み、wakeを実行権として扱わない。
- 子 process の成果物は上限、path、件数、schema、checksum を親が検証し、失敗時に部分公開しない。
- 親の重いblocking処理は一つの実行枠を実処理の完了まで保持する。呼出Futureのtimeoutだけで枠を再利用せず、処理が残る場合はworkerを停止する。Tokio runtimeの終了も同じ停止期限の残り時間を使い、blocking taskの待機で無期限に延長しない。
- 分析worker内のRust validatorをpayload意味、canonical encoding、resource集合・相互参照の単一ownerとする。parentは完全検証を通ったopaque artifactだけをversion付きで公開し、APIはそのimmutable publication attestation、生成schema、reader resource上限、request identityだけを独立に検証する。
- 分析成果物の公開とレーダー基準準備を実行目的で区別する。基準準備も同じqueue・共有実行枠・親子process境界を使い、保存元と全scopeの比較を検証する。準備の成功を通常の分析要求の充足や公開完了として扱わない。
- 分析release controllerはactiveなalgorithm / artifact schema / validation contract singletonと全titleへのpromotionを所有する。API / workerのcapability registryを検査中だけ凍結し、互換判定とdesired-state切替の間へ別世代を割り込ませない。
- 入力 version、algorithm version、artifact schema version、固定採点基準を別の識別として扱い、同じ入力・algorithm・基準の内容では決定論的にする。基準の適用日時と公開競合の世代は、計算内容のchecksumから分離する。
- 計算の中間表現は必要な観測値だけを持ち、fold・bootstrap・permutationごとに識別情報や未使用featureを複製しない。共有できる入力は借用し、計算順序や乱数列に意味がある最適化は出力のcanonical bytesまで比較する。結果の意味を変える場合はalgorithm versionの変更として扱う。
- 公開前のDB照合はtransaction内で行い、全Rowとdecode後の同じ集合を重ねて保持しない。metadataは借用して逐次照合し、入力は必要なshapeへ集約する。順序の違いを許容する照合でも欠落・余剰・重複・値の不一致を拒否する。
- 待機候補では OCR を先に選び、実行中の分析は完了させる。共有実行枠、旧世代の中断 intent の回収、再queue、失敗回数、公開の詳細は `docs/requirements/series-analysis-batch.md` を正本とする。

- 分析完了通知は `notifications/analysis` が実行attemptに結び付いた試合変更要求と前後のimmutable入力を照合し、公開transaction末尾で要求の完了を再確認して表示metadataを固定する。入力が変わらない成果物の再利用は公開制御側で通知準備を省略する。通知準備はOCRと同じ回復可能なSAVEPOINT境界を使い、正常commitを確認した経路だけが共通senderへ渡す。分析child・API・Summitに平均計算やproducer送出の責務を移さない。内容と比較範囲は `docs/requirements/series-analysis-batch.md` を参照する。
- 通知producerへ渡すのは通知に必要なjob・attempt・作品・成果物versionの識別情報だけとし、DBのclaim型、lease、fenceや全体設定へ逆依存させない。
- 通知の入力基準は画面用current / previousから分離する。公開制御は通知の可否とは独立して、公開・再利用成功と基準の更新を一つのtransactionにする。初回と不明を区別し、読取不能な旧形式でも入力metadataの完全性を確かめた範囲で差分を扱う。旧平均を現行形式として解釈せず、基準不足を全試合の追加に置き換えない。
- 比較用の成果物取得は同じsnapshot内で前後の全試合identityとscope metadataを照合し、差分判定後に作品通算と影響シーズンの保存済みplayer metricsだけを取得する。公開validatorが保証するimmutable成果物の意味検証に依存し、元成果物のbyte・件数上限、全identity・scope整合性、取得した順位のtyped decodeは維持する。比較準備の時間枠には接続確立と全DB往復を含め、確定transaction内の準備とともに親の絶対期限から業務commit・復旧の余裕を残す。比較read transactionが正常commitした新規接続は続く公開transactionに再利用し、失敗・timeout時は破棄する。

### OCR Capability / Worker Role

- OCR の object / 入力 / 状態契約は `docs/ocr-job-contract.md` と schema を正本とし、URL、credential、local path を runtime 間 payload にしない。
- 検証済み画像はprocess adapterへ所有権を渡し、headerと画像を順に転送するためだけの全量frame複製を作らない。認識fallbackは既存の評価順を保ち、必要になった画像だけ生成する。
- OCRの不確かな読取値は、必要な警告を保持して要確認結果として保存する。件数の妥当性しきい値を保存拒否の上限に読み替えず、parserと保存前検証で警告条件を一致させる。構造・型・対応関係が壊れた候補や警告の欠落は拒否する。
- OCR・分析通知のenvelopeは `momo-notifications` が種類とsource identityから通知IDとwire versionを構築する。OCRは送出単位のv2、分析は論理job単位のv1。各producerは固定dataと確定時刻・世代を渡し、commit後のhandoffは制御側が所有する。
- 新規producer送出は[通知サイズと送出可否](requirements/base.md#通知サイズと送出可否)に従い、最終envelopeのHTTP本文・JSONB text表現と掲載内容を制限する。共有wireの保存互換や分析の比較履歴読取と、新規送出上限を混同しない。上限超過は通知全体の省略とし、業務成功と分析の入力基準更新を維持する。描画後の投稿数検証はSummitが所有する。
- APIは `ocr_submissions` / `ocr_submission_members` に所有者・固定画像集合・受付期限を原子的に保存し、job登録とmember対応を一つのtransactionにする。同一操作のPUTと登録済みmemberの再送は同じ識別子へ収束する。Webは全画像の内容識別とupload keyを送出受付前に固定する。
- OCRの受付調停は現在の下書きslotではなく固定memberと対応jobの終端を読み、全員終了後だけ送出を確定する。下書き→送出の順にlockし、業務更新後の最後にresult gateと設定を読む。ONなら文脈と失敗だけを固定し、OFFでも送出は終端にして後から再構築しない。画像0件の期限終了も回収し、後の送出・slot状態を上書きしない。
- 受付調停は共通listener確立後の初回・再接続・期限・低頻度の安全走査でopenを巡回する。workerが最大一つの有限stepを駆動し、cursor・上限付きの発見済みID・Busy再確認予算をwakeと接続交換の間も保持する。softな走査予算を使い切っても先頭の一件は試み、途中の進捗を次のstepへ渡す。Busyだった送出だけを早期再確認し、通常の安全走査・受付期限を後ろへ延ばさない。
- 受付調停と画像Runnerは可変資源を別々に所有し、OCR画像・分析の共通実行枠と独立して調停を進める。受付数に比例するtask・接続・全件待機一覧は作らない。画像Runnerの生成と呼出しはOCR orchestratorに閉じ、各画像はworkerが共有枠をclaimした後だけ実行する。未到着memberの受付期限と登録済み画像jobの実行期限を混同しない。
- commit後のwake hintは損失可能で、正本は保存状態。各送出を有限のtransactionで扱い、settled commitを確認した経路だけが通知をdispatchする。共有wire・宣言的な保存構造と排他契約は `../momo-db/docs/discord-notifications.md` を正本とし、DBへ終了policyやtriggerを置かない。
- 通知準備は確定処理と同じ絶対期限から残り時間を計算し、実行中SQLの終了・SAVEPOINT復旧・業務commitの時間を確保する。余裕がなければ通知用SQLを実行せず、復旧可能な準備失敗では業務成功を保って通知を省略する。commit成功後だけ、件数・bytes・同時接続数に上限を持つ共通senderへ渡す。OCR の実行枠解放はHTTP完了を待たない。
- 通知の一回限りのSQLはパラメータ型を明示し、statementの準備・実行を分ける不要なDB往復を避ける。共有gate取得とsnapshot取得は別statementのまま維持する。比較・準備のtimeout、残時間不足、DBエラーは区別し、準備失敗には処理段階・時間予算・経過時間・SQLSTATEを記録する。DB例外本文やbind値は出力しない。
- senderはDNS・接続・応答を含む単一のrequest期限内で一度だけHTTPを試み、整合する受付応答を永続受付の証拠として扱う。予約からdispatch、送信queue待ち、HTTP処理の時間を既存のattempt・receipt記録で区別する。接続だけを先に打ち切る短い期限を重ねず、TCPの一時的な停滞からの回復も同じ期限に含める。応答不明時も通知outbox・再試行・再起動時の再構築は行わない。停止時はproducerの確定と最後のdispatchまで通知受付を保ち、producerのsink・予約を解放してから、残りの共通期限で通知をdrainしてtask終了を確認する。通知待ちだけの期限切れで正常な業務停止を失敗にしない。senderは独立したtaskとして監視し、捕捉可能なpanic・予期しない終了では通知受付を閉じて業務を継続する。通知taskを自動再起動せず、所有者の破棄だけで終了確認済みと扱わない。この異常隔離は稼働中のsenderが対象で、通知設定不正やHTTP client初期化失敗は起動失敗として扱う。

## 5. Runtime / Security

- 保守中の停止境界は API / runtime tool / Worker で同じ起動契約を使い、未知値を通常稼働へ fallback させない。未指定または通常 mode は既存動作を保つ。
- frozen の API は通常の認証、業務 route、storage、wake、定期 cleanup を配線しない。Worker は通常 runtime を生成せず、claim、回復、materialization、capability heartbeat、通知送信を開始しない。再起動でもこの境界を保つ。
- frozen の生存確認、read-only readiness、通常稼働の smoke は別の結果として扱う。readiness は既存 schema と reader 契約を確認し、接続値・世代値・業務 data を応答や error へ出さない。新しい保守 table の存在を起動条件にしない。
- frozen では既存の read-only audit だけを許し、release の変更・preview や子 process の起動を通常 command から通さない。限定した保守書込みには別の明示契約が必要であり、frozen の指定だけでは許可しない。drain と再開の判断はこの停止境界から独立させる。

- secret、session / CSRF token、接続 URL、画像内容、OCR raw text、分析成果物本文をログへ出さない。例外は安全な分類情報へ正規化する。
- productionのDB接続は暗号化と相手検証を維持し、接続のために認証要件を暗黙に弱めない。
- upload は許可形式、byte 数、寸法、内容 fingerprint を完全 decode 前後の境界で検証し、画像実体や長寿命 URL を DB / 公開 DTO に置かない。
- 画像objectは作成後に上書きせず、再送は保存済みの内容と照合する。localとobject storageで読取上限と整合性検証を共有し、未検証のdescriptorから任意のfileを読まない。
- health、dependency readiness、機能応答、resource / performance を別の証拠として扱う。
- stream response は handler 完了ではなく転送終了時に success / error / cancel と byte 数を exactly once 観測する。
- runtime image は最小権限で動かし、診断手段を残す場合も provider 設定や攻撃面を public docs へ複製しない。
