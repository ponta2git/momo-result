# テスト・品質規約

目的: 変更種別ごとのテスト選択、oracle、品質ゲート判断の正本。

## AI作業導線

この文書は「何をどの境界で証明するか」を選ぶ。coverage値、CI artifact、具体的な実行コマンドの正本ではない。

| 項目 | 到達先 / 判断 |
| --- | --- |
| 第一読 | テストを追加・修正する、変更範囲のgateを選ぶ、障害の再発防止testを決めるときに読む。 |
| この文書だけで決めること | 変更経路に対応するtest layer、oracle、未検証として報告すべき条件。 |
| 常に併読 | `docs/dev-rule.md`。選んだ検証を実行するコマンドと変更gateは開発規約を正とする。 |
| 条件付き併読 | coverage / CI artifact / test sizeは `docs/test-architecture.md`、DBは `docs/db-rule.md`、OCR queueは Redis契約、分析job / artifactは `docs/series-analysis-realization.md`、完了前の再発防止確認は `docs/post-mortem/lessons.md`。 |
| 実行正本 | test source、test config、CI workflow、schema / fixture、対象runtime。 |
| 検証先 | 本書の変更種別ごとの規則から、`docs/dev-rule.md` の該当gateへ進む。外部wireを実行しなければ、そのwireは未検証と報告する。 |

## 1. Principles

- 変更した実行経路を直接通す。近いテストの成功で代用しない。
- テスト層の責務を混同しない。unit、HTTP、repository integration、E2E は別の失敗を捕まえる。
- 障害対応では、報告された操作、query、endpoint、usecase分岐そのものを回帰テストに含める。
- 外部サービス依存の検証が skip / 未実行なら、その挙動は未検証として報告する。
- assertion はユーザー可視状態、request / response DTO、DB row、queue payload、state transition、Problem Details などの外部契約に置く。
- `exists`、`length > 0`、成功/失敗 boolean だけで終えない。
- 非同期は sleep / wall clock で同期しない。deferred promise、test clock、状態観測、wire integration gate を使う。
- 共有 mutable state、固定 writable path、module-scope store は test ごとに分離・cleanup する。

## 2. Test Layers

| 層 | 捕まえるもの | Gate |
| --- | --- | --- |
| domain / pure logic | 不変条件、分岐、validation、parser、ViewModel | `sbt test`, `cargo test`, Vitest |
| usecase / app service | 状態遷移、副作用境界、repository contract | `sbt test`, `cargo test` |
| HTTP/API | request parsing、auth/CSRF、response encoding、error mapping | `sbt test` |
| web component/page | UI状態、入力操作、APIエラー表示、query cache lifecycle | `pnpm test:run` |
| PostgreSQL repository | SQL syntax、transaction、PostgreSQL固有挙動 | `sbt apiDbQuality` |
| DB contract | table / column / seed / nullable / default | `sbt apiDbQuality` |
| Redis integration | Redis Streams wire 動作、ack/claim/retry | `sbt apiRedisQuality`, Processing Worker integration |
| Processing Worker runtime | 数値正確性、OCR解析、payload validation、job状態、timeout、原子的公開 | `cargo test`, Processing Worker integration |
| Runtime / E2E smoke | Caddy / HTTP/2 / API / DB / Redis / Processing Worker / browser 結合、ログイン後主要UX | deploy workflow, Playwright |

通常の `sbt test` と `cargo test` だけでは外部wireを保証しない。DB/Redis/R2/native OCRなどの動作を
検証したと言うには、対応するintegration gateの成功が必要。

## 3. Web Rules

### Query / API Error

TanStack Query の `queryKey`、`queryFn`、API wrapper、ViewModel変換、error表示、mutation後cache反映を変更した場合:

- `query.error` / `isError` だけをページ失敗表示の根拠にしない。
- 認証、`enabled`、`isFetching` / `fetchStatus`、cached error、refetch success の lifecycle を通す。
- 同じ backend resource を複数画面で読む場合は、cache shape と invalidation 範囲を検証する。
- mutation で作成した resource を同画面で選ぶ場合は、選択値と候補 list/select の両方を検証する。

### Form / Interaction

form、filter、select、input、button、Zod schema、request transform、mutation payload を変更した場合:

- Testing Library + `userEvent.setup()` で変更した操作を直接実行する。
- React event の値は handler 内で退避し、state updater 内で event / DOM node を読まない。
- route param、prefill、hidden state 由来の workflow identifier が request body に残ることを検証する。
- optional field が mode discriminator なら、各 mode の payload と副作用を検証する。
- PC用とモバイル用でUIが二重なら、検証した経路を明示する。
- UI表示や操作経路を変える refactor では、対象画面の Testing Library test または E2E smoke を追加・更新する。見た目だけの分割でも、ユーザー可視の loading、empty、error、success 状態が変わるなら oracle を置く。
- UI の semantic token、余白、motion、z-index、touch target を変えた場合は `pnpm --filter web lint` で UI consistency check を通し、PC / mobile で主要操作が隠れたり重なったりしないことを Playwright で確認する。

### Test Foundation / Doubles

- 共通 setup、QueryClient、MSW lifecycle、factory、DOM double は既存の `apps/web/src/test/` 配下の helper を使う。
- MSW の module-scope store を増やしたら reset 対象へ登録する。
- 出現待ちは `findBy*` を優先する。`waitFor` は disappearance、複数 assertion、non-DOM assertion に限る。
- pure logic は `node`、DOM / browser API / direct fetch 境界は `jsdom` のように、必要な test environment を明示する。
- `console.error` / `console.warn` は失敗扱い。React `act` warning、duplicate key、未実装ブラウザ副作用を放置しない。
- test double は production adapter の契約を弱めない。通すだけの mock より、request body、response shape、状態遷移を観測できる double を使う。
- 装飾画像や装飾用 `data-*` 属性そのものを component / page test の主 oracle にしない。画像が機能要件なら、アクセシブル名、操作結果、download、navigation などユーザー可視の契約で検証する。

### Locator / E2E

- Playwright locator は、実際のアクセシブルロールと名前を組み合わせて対象を一意にする。
- フォーム項目とナビゲーション、tab と button など、同じ表示名が複数ロールに現れる画面では `getByLabel` や広い text locator だけで選ばず、`getByRole("combobox" | "tab" | "button" | "link", { name })` で操作対象を明示する。
- retry可能なE2Eは「最新」「唯一」といった共有状態を前提にせず、そのattemptが作成したID、URL、hrefなどの
  stable identifierで対象を絞る。前attemptのfixtureが残っても別resourceを操作しないことを優先する。
- Playwright E2E smoke は、開催作成、OCR取り込み開始、OCRレビュー確定、試合詳細、CSV/TSV出力、マスタ/alias管理などの主要UXを狭く通す。
- E2E assertion は見出しの存在だけでなく、API response、URL、download scope、DB-backedに保存された結果など、壊れ方を捕まえる外部契約に置く。

## 4. API Rules

- usecase / domain / HTTP 境界テストは、実DTO、実 codec、in-memory repository、実状態遷移を優先する。
- interaction verification は外部副作用、失敗注入、ログ観測、時刻、乱数、ネットワーク境界に限定する。
- stateful test double は test ごとの `IO` / `Resource` / fixture で生成する。module-scope の `Ref` や可変状態を共有しない。
- 値 fixture は意味のある factory / builder に寄せる。境界変換そのものを検証する場合を除き、raw map や文字列連結を主オラクルにしない。
- HTTP app 起動は request parsing、auth/CSRF、response mapping が oracle のときに絞る。
- architecture rule を追加した場合、可能なら `ApiEndpointsArchitectureSpec`、`ApiRuntimeArchitectureSpec`、または lint 相当の検査へ固定する。
- Tapir security endpoint、Doobie named row mapping、戦績比較 engine / presenter 境界などの横断規約を追加した場合は、代表経路の unit / HTTP / integration test に加え、import 禁止や文字列パターン検査で architecture spec へ固定する。
- Ciris / Iron による設定・endpoint境界制約を変更した場合は、対象 loader / codec の unit test に加え、`ConfigArchitectureSpec`、`BoundaryIdSpec`、該当 codec spec で「手書き parser へ戻っていないこと」と「不正 raw value を境界で落とすこと」を固定する。

### DB-backed API

PostgreSQL repository、Doobie query、DB table/column、migration 前提に触れたら:

- endpoint / usecase / repository / method を特定する。
- 新しい table / column / seed / nullable / default 前提は `DbContractSpec` に追加する。
- 変更した repository method を Testcontainers PostgreSQL で実行する。
- 同一 transaction で FK 関連 row を作成・更新する method は、成功 path と保存後の linked row values を検証する。
- PostgreSQL runtimeで画像uploadからOCR job作成までを変更したら、productionと同じDB-backed画像lifecycleを
  local storage modeでも通し、`source_images` の参照整合性とopaque relative object keyをruntime E2Eで確認する。
- DB-backed画像quotaを変更したら、上限直前から同一accountへ並行予約し、成功件数・合計bytesが上限を超えないこと、同じ冪等keyのretryが枠を再消費しないこと、参照済み画像が未参照quotaへ数えられないことを実PostgreSQLで固定する。
- source image lifecycleを変更したら、OCR attachとorphan遷移の両lock順、下書き確定・取消と削除intent、
  `FAILED` object検査後の再uploadとpurge claimをgatedな2接続 / recording object storeで競合させる。
  最終状態が参照付きobjectの保持、または明示的なretry拒否のどちらかへ線形化されることを固定する。
- OCR作成transactionを変更したら、job / draft / attachment / queue payloadのimage IDとmetadata不一致を
  mutation前に拒否し、source rowの`AVAILABLE`確認とdraft attachが同じlock境界にあることを固定する。
- response bodyの観測を変更したら、pull前、正常終了、途中error、cancelをgated streamで通し、転送完了eventが終了後にexactly onceだけ記録され、bytesとoutcomeが一致し、例外messageをログへ出さないことを固定する。
- 試合一覧paginationまたはstatus projectionを変更したら、OCR success / failure / cancel / stale failureが
  `match_drafts.status`と同じtransactionで確定することを固定する。500件以上の偏ったfixtureで全sortの
  first / previous / next / last、同値tie、filter違いcursor拒否、改ざんtokenのscope外row非返却を実PostgreSQL
  とHTTPで通し、後続page queryへ`OFFSET`と反復exact countを戻さない。
- scope指定exportのprojectionを変更したら、上限を超える同作品・season履歴から1試合だけを選び、sequenceと
  golden wireが従来契約と一致し、非選択試合のplayer / incident破損や件数が選択結果の取得量へ影響しないことを
  実PostgreSQLで固定する。
- 新しい table に書き込む integration test を追加したら cleanup 対象も更新する。
- SQL shape と domain 変換を分けた場合、row mapping の成功 path と不正 DB 値の扱いを repository unit または integration test で確認する。tuple mapping を named row へ変えた場合も、対象 query を実PostgreSQLで実行し、必要なら repository architecture spec へ禁止パターンを追加する。

### Performance-sensitive analytics

集計API、推薦API、ドリルダウン、モデル計算など、純粋計算の追加・変更でCPUまたは応答時間が増える可能性がある場合:

- 画面名や変更ファイルではなく、実際に同時実行されるAPI、job、worker、engineの経路を特定する。
- 戦績比較、振り返り、ドリルダウンAPIで分析engineが実行されず、同じartifact IDを読むことを
  architecture / usecase / HTTP testで固定する。
- 固定4名、現在データ量の2倍かつ最低500試合/作品に、season、map、実在組合せ数と件数偏りを加えた
  決定論的fixtureを用意する。公開可能な下限fixtureは
  `scripts/ci/series-analysis-resource-fixture.sql` とし、現在データshapeが上回る場合はprivate fixtureを使い、
  correctness testとは別に処理時間、計算回数、peak memoryを検証する。
- 上限fixtureを単一実行枠で100回連続実行し、OOM、runtime再起動、未解放memoryの増加傾向がないことを
  本番同等runtimeで測定する。provider固有の上限値と実測結果はprivateに残す。
- 同じ作品成果物内で同一の高負荷計算が通常集計、振り返り、ドリルダウンごとに重複していないことを
  直接検証する。片方のunit testやresponse shape testの成功で代用しない。
- 各APIが要求resource・scopeのbounded chunkだけを読み、作品全体をdecodeしないことをSQL、取得byte、API
  peak memoryで固定する。同じ上限fixtureを実browserでも開き、response size、parse、heap、操作応答を測る。
- 定義済みの対象なし・件数不足・モデル非採用は正常成果物として固定する。予期しない1スコープの
  失敗では作品成果物全体が失敗し、部分公開せず直前成功成果物を維持することを固定する。
- runtime smoke / E2Eが機能成功だけを確認している場合、CPU回復や性能予算を検証したとは報告しない。外部メトリクスが未取得・未実行なら未検証として明記する。
- payload byte数、manifestを含む一時総byte数、親process HWM、子process HWM、runtime / cgroup peakを
  同じ名称へ畳み込まない。子reportと検証済みmanifestの件数・byte数が不一致なら成功測定にも公開にも含めない。
- 現行のanalysis child 192MiB制限を変更せずに100回連続検証する場合は、
  `scripts/ci/series-analysis-endurance.sh` を使う。DB、対象作品、runtime外部peakファイルを
  明示し、外部peakが未取得なら成功扱いにしない。このゲートはOCR側runtimeのメモリ設定を変更しない。
- rollbackでは、対象commitのartifact identityだけでなく、削除対象のユーザー経路とサーバー実行経路が消えたことを直接確認できる回帰ケースを用意する。

実DB実行が特に必要なSQL:

- `UNION` / `INTERSECT` / `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- 複数 table をまたぐ filter / order / limit

## 5. Processing Worker Rules

### 5.1 Parent / Child Common Contract

- Analysis / OCRの両Worker roleについて、`consume -> claim / lease / shared slot -> child起動・監視 -> candidate検証 ->
  durable commit -> post-commit effect -> ACK / leave-pending`の順序を同じcontract testの観点で固定する。
- Redis Streams PEL recoveryを変更する場合は、起動時cold scan、空queueでのinterval待機、page間の新規配送read、
  known retryのidle-threshold再確認、local target数とscan page数の上限を制御可能clockのtestで固定する。
- processing parent processがDB / Redis / object storage、process lifecycle、timeout / preemption、fence、outbox、ACKを
  所有し、attempt childがdurable DB write、Redis、outbox、ACKを行わないことをarchitecture / process testで固定する。
- Analysis childのread-only DB + attempt directory、OCR childのframed stdin / stdoutは能力固有transportとして
  個別testを持つが、どちらも1 attemptだけを実行して非authoritativeなbounded candidateを返すことを共通oracleにする。
- supervisorはconsumer / outbox coordinatorのshutdownとunexpected exitだけを扱い、能力固有SQL、payload、
  retry判断へ依存しないことをarchitecture testで固定する。
- outboxを書き得るRust control transactionは、commit成功時だけtyped `PostCommitEffects`相当を返し、rollbackでは
  effectを返さないことを固定する。nested recovery / follow-upのeffectが上位結果へ集約され、consumerが元deliveryの
  dispositionより先にsinkへ渡すことを検証する。
- OCR roleが期限切れAnalysis holderを回収して分析outboxを作る場合はAnalysis wakeを返すこと、OCR transient retryは
  outbox wakeを返さず既存Redis PEL deliveryをpendingのまま使うことを固定する。
- event-driven outboxへ触れた場合は、連続wakeがoutbox種別ごとにcoalesceされること、startup drainが残存outboxを
  回収すること、due workが空になった後は次wake / 最短deadline / 設定されたcold timerまでrepositoryを呼ばないこと、
  複数retry / semantic deadlineが最短1件へcoalesceされることを決定論的なclock / signal testで固定する。
- post-commit decoratorは失敗結果でwakeせず、成功結果からwakeまでのcancel maskを固定する。DB effect全体や
  Redis I/Oをuncancelableにしない。
- publish成功はRedis appendだけでなくoutboxの`DELIVERED`確定までを条件とし、append後DB更新失敗ではactive処理が
  完了扱いにならず、claim expiry後の重複deliveryへ安全に収束することを固定する。
- drain全体のrecoverable failureではcoordinatorが終了せず、制御可能clock上の上限付きbackoffまでrepositoryを
  再呼出ししないこと、backoff中のwakeが失われないことを固定する。unexpected coordinator exitはsupervisorが
  sibling taskを停止することを固定する。

### 5.2 OCR Capability / Worker Role

- runner / parser / domain / payload validation は、実 dataclass、実 parser、in-memory repository / consumer、実状態遷移を優先する。
- accuracy gateはversion固定の回帰datasetと項目別oracleを使う。独立blind holdoutは必須とせず、未知画像への
  一般化を保証したと報告しない。新しい誤認識は再現可能な回帰fixtureへ追加し、Rust側で前進修正する。
- interaction verification は Redis wire adapter、native OCR API、process composition、worker loop の停止・retry 境界に限定する。
- Docker、Redis、PostgreSQL、native OCR engine、tessdata は integration marker へ分離する。
- screen type 判定、queue payload validation、failure code mapping、ack / pending / DLQ、parser profile selection、OCR postprocess の複合条件は table-driven test にする。
- oracle は OCR draft payload、warning / failure code、queue ack / DLQ field、DB row、画像メタデータなど外部契約に置く。
- fixture は domain 上の意味が分かる名前にし、大量の inline dict / temporary image を増やさない。
- OCRのsemantic redeliveryはrecent `DELIVERED`、`running`、terminal jobを変更せず、thresholdを過ぎた
  `queued` jobの既存outboxだけを`PENDING`へ再武装することを実PostgreSQLで固定する。

## 6. Analysis Capability / Worker Role Rules

- 純粋計算はDB、Redis、clock、process、wire DTOから分離し、数式、分母、同値、丸め、境界、品質状態を
  table-driven testとproperty testで固定する。
- 浮動小数点結果は、要求から手計算できるgolden fixture、高精度参照計算、数学的性質のいずれかを
  oracleにする。現行Scala値は差分検出に使えるが、より正確な値を否定する唯一のoracleにしない。
- Scala版と意図的に異なる結果は、正確性の証拠、影響fixture、algorithm version更新を同じ変更で残す。
  意図しない丸め差、入力順による揺れ、seed非再現は不具合とする。
- job、intent / outbox、execution slot、fence、lease、artifact repositoryは実PostgreSQLで、publish、
  pending、claim、ackは
  実Redisで検証する。unit doubleだけでwire動作を検証済みとしない。
- 試合mutationと再計算intentの同一transaction、連続mutationのcoalescing、重複deliveryの冪等性、
  terminal DB write before ack、stale lease回収をintegration testで固定する。
- deploy世代の異なる2 worker相当を同時実行し、全体slotが1件だけであること、失効fencing tokenから
  heartbeat、terminal化、公開、slot解放ができないことをintegration testで固定する。
- 新version非対応の旧workerがjobをclaim・terminal化・配送消失させず、durableな再配送を経て対応workerが
  処理できることと、旧consumer drain前にversion campaignを開始できないことを固定する。
- attempt開始後の手動request、全作品target snapshot、展開途中crash、DB commit応答喪失後のreconcileを
  直接通し、予約消失、対象欠落、二重job、二重公開がないことを確認する。
- publication Phase A中にcurrent pointerが不変でcontrol rowをlockしないこと、partial COPYがrollbackすること、
  commit応答不明後にfresh接続で完全stagingを照合できることを実PostgreSQLで確認する。Phase Bは旧fence、lease失効、
  manifest改変でpointer / job / slotを全rollbackし、成功時だけ一括更新することを確認する。
- 全作品操作の同一idempotency key再送と異なるkeyでの後発操作を分け、後発操作より前のattemptが誤って
  充足扱いにならず、必要な次runだけを作品単位で共有できることを確認する。
- Redis append後のoutbox更新失敗、重複delivery、stream消失後のqueued job再配送を実Redisで通し、
  DB上のqueued jobが配送路から孤立しないことを確認する。
- Analysis roleがsupersede、retry、interruption、lease recovery、follow-upで作るoutboxは、commit結果に
  Analysis wakeを含むことをRust control-plane testで固定する。dispatch失敗でもoutboxを残して元attemptの確定や
  delivery dispositionを巻き戻さず、成功後のsemantic deadlineまでは追加reconcile queryを行わない。
- transient DB / queue failureの最大3回再試行と、timeout・入力契約違反・決定論的失敗の非再試行を
  decision tableで検証する。
- 子processの正常終了、異常終了、hard timeout、親process停止を実process testで通し、部分成果物、
  zombie process、二重公開を残さないことを確認する。
- 採用runtime上で子processのmemory hard limitを意図的に超過させ、子だけが終了し、親processが生存して
  terminal失敗を保存できることを確認する。process単位の制限機構が利用できるという推測で代用しない。
  子のsignalやOOM eventだけを合格根拠にせず、対象cgroupのlimit-hit counter増分とlimit readbackを同時に
  確認し、runtime全体のOOMを子cgroupによる隔離成功と誤認しない。
- 親processのgraceful終了だけでなく強制終了を通し、parent-liveness channelで旧子process groupが消えてから
  lease回収後の新attemptが開始することを確認する。
- 一時directoryのdisk不足、byte上限、symlink、path逸脱、manifest欠損・破損と、全終了経路・起動時の
  限定cleanupを実file system testで確認する。
- 対象試合revision不一致では古いmatch contextを返さず、artifactのread中cleanup競合でも整合した1 chunkを
  返すことを実PostgreSQL / HTTP testで固定する。
- API artifact materializationを変更したら、最大wire bytesと最大JSON node数を同時に満たすfixtureを設定上の
  decode concurrencyで並行処理し、strict UTF-8、孤立surrogate、depth / node超過、response byte境界、
  `application/json`のwire bytes完全一致を固定する。DB connectionはdecodeを停止した間も返却済みであることを
  別のqueryから確認する。
- Rust OCR同居またはexecution slotを変更するときは、OCRから分析へのpreemption、逆方向の禁止、
  失敗回数非加算、最新版への再queue、commit critical section、子process group回収、同じcgroupでの
  後続実行を実process / integration testで固定する。
- terminal jobの終了後45日保持と管理画面の直近3件取得は別契約として検証し、表示件数をDB削除条件に
  流用せず、古い `queued` / `running` jobをcleanupしない。
- 確定試合0件を含む全登録作品が管理画面の1作品候補になり、登録作品0件ではempty stateとなることを
  API / component testで固定する。比較画面も同じ全登録作品を返し、season / map候補だけを確定試合から作る。
- resource/performance gateは機能gateと分け、本番同等runtime、release build、実際のresource上限で行う。
  timeout値は通常、上限、cold start、連続実行のp50 / p95 / p99 / 最大時間を測定後に決める。

## 7. Coverage / C2

- サブシステム別の対象範囲、テストサイズ、CI artifact 方針は `docs/test-architecture.md` を正とする。
- coverage 閾値は各設定ファイルを正とする。
  - web: `apps/web/vite.config.ts`
  - api: `apps/api/build.sbt`
  - processing-worker: 現時点ではcoverage率をrelease判定へ使わない。`cargo test` のfixture / property / state-machine
    oracleと、実PostgreSQL・Redis・Linux process smokeを正本とする。coverageを導入する場合は
    `apps/processing-worker` のCI設定と同時にこの記述を更新する。
- aggregate coverage だけで重要経路を保証しない。blast radius が大きい下位モジュールは file / glob 単位または明示的な table test で固定する。
- C2 は coverage tool の branch coverage だけでは保証しない。`&&`、`||`、三項演算子、mode discriminator、`enabled`、`isFetching`、`isError`、cached data 有無などは decision table で独立因子と期待値を示す。
- 型耐性が重要な fixture は生成型、domain型、`satisfies` などで shape 変更を型エラーにする。

## 8. External Services

- PostgreSQL-backed spec は `Integration` と `DbIntegration` tag を付け、`apiDbQuality` で実行する。
- Redis-backed spec は `Integration` と `RedisIntegration` tag を付け、`apiRedisQuality` で実行する。
- API integration tag は `apps/api/src/test/scala/momo/api/testing/TestTags.scala` を正本とし、spec 内で直接 `new munit.Tag(...)` しない。
- PostgreSQL-backed spec は `IntegrationSuite`、Redis-backed spec は `RedisIntegrationSuite` へ寄せる。
- Processing WorkerのPostgreSQL / Redis integrationは通常の `cargo test` と分離し、CI上で実サービスを
  起動する `series-analysis-control-plane-smoke.sh` を明示gateとして持つ。
- Rust OCR consumerのPostgreSQL / Redis integrationは通常の `cargo test` と分離し、隔離した実サービスへ
  `ocr-rust-control-plane-smoke.sh` を明示gateとして実行する。DB terminal writeより先にRedis配送をACKしないこと、
  旧fenceの拒否、PEL回収、bounded DLQを外部契約として確認する。
- 分析 / OCR統合は検証済みruntime imageと隔離PostgreSQL / Redisを使う
  `processing-worker-preemption-smoke.sh` を明示gateとし、一方向preemption、失敗回数非加算、子回収、slot解放、
  同じcgroupでの分析復帰を実processで確認する。
- R2 adapterは通常testから分離した `apiR2Quality` を、検証専用の隔離bucketと明示credentialで実行する。
  put / head / get / delete、metadata / checksum、削除後のnot-foundを一つのprobeで確認し、未実行を成功扱いしない。
- 外部サービスを使う spec は、stream名、DB row、一時ファイル名、worker id を test / suite ごとに分離する。
- CI actionやprovider APIの出力をrelease来歴へ取り込む境界では、公開契約のwire表現をfixtureに使い、正規化後の値がconsumer validatorを通ることをcontract testで固定する。都合のよい型・接頭辞・表現をmock側で仮定しない。
- 部分再実行可能なrelease workflowでは、producerとconsumerのattemptが異なるfixtureを必須にし、consumerがproducerのimmutable artifact IDと候補attemptを使うこと、deployment来歴が候補attemptとdeployment attemptを区別すること、旧来歴をrollback validatorが引き続き受理することを直接検証する。
- 直接接続したPostgreSQL testはpooler / proxyのstartup parameter互換性を保証しない。release probeでsession timeoutを使う場合は、connect引数とtransaction-local commandを観測するcontract testを置き、production互換の接続境界でread-only smokeを通す。
- 公開edge smokeはURLだけでなく観測地点も契約に含める。edge policyが意図的に拒否するshared runnerをblocking oracleにせず、管理下のproduction互換地点から公開DNS / TLS / edgeを通す。拒否responseを成功扱いするfallbackや、CI都合のallow rule追加で代替しない。
- postdeploy evidenceのcheckを追加・変更したら、通常deployとrollbackの全consumerを同じvalidatorで検証する。rollbackは旧世代targetのfixtureでも必須core checkを受理し、現在世代では追加checkを要求できることを固定する。workflow内へ世代固有のcheck配列を複製しない。

## 9. Quality Gates

標準 gate は `docs/dev-rule.md` の Change Gates を正とする。

追加判断:

- API / web DTO 契約を変えたら OpenAPI生成物と web generated type を更新する。
- API coverage 対象ロジックを変更したら `docs/dev-rule.md` の `sbt apiCoverage` を実行する。
- Redis Streams / OCR queue 契約を変えたら `docs/redis-streams-ocr-contract.md` の Required Tests を実行する。
- 30秒pollからevent-driven outboxへ切り替える変更はRedis payloadとDB schemaを変えない限り、queue dispatcherの
  unit / DB integration、既存Redis quality gate、分析workerの対象control-plane testを必須範囲とする。
  全分析計算benchmark、browser E2E、dual-run shadowはこの配送切替だけを理由には要求しない。
- Analysis capability / Worker roleを変えたらformat、Clippy、unit test、PostgreSQL / Redis integration、release buildを
  実行する。数式または候補採用を変えたらalgorithm version判定も行う。algorithm versionを進める変更では
  release DB smokeとcontrol-plane smokeを必須にし、release fixtureのworker capability、promotion target、
  queued jobが同じversionへ収束することを直接確認する。
- 非対応versionのdeliveryは、実PostgreSQL / Redis / worker経路でjobがattempt未開始の `queued`、deliveryが
  pendingのまま保たれ、`analysis_delivery_deferred` の安全な構造化logで原因を判別できることを固定する。
- processing-workerのClippyは `Cargo.toml` のdeny設定を正本とし、全target / 全featureで実行する。
  productionのlint抑制、`process` 外のunsafe、testを含む900行超module、PostgreSQL `Row::get` の再導入、
  pure coreからruntime / OS依存への参照はarchitecture testでも拒否する。lintや依存境界を弱めて通す変更は、
  同等以上の決定論的検査がない限り認めない。
- `cfg(target_os)` を含むworker変更は開発host上のClippyだけで完了扱いにせず、production target OSで
  native build依存を明示的に導入した上で全target / 全featureのClippyとtestを通す。
- version付き浮動小数点式へFMA化、評価順変更、丸め変更を入れた場合は、単体精度だけでなく共有fixtureの
  semantic checksumを確認する。checksumが変わる変更は自動修正として扱わず、algorithm version更新判断を行う。
- DB schema 前提を変えたら `docs/db-rule.md` の Consumer Contract を満たす。
- `docs/post-mortem/lessons.md` に該当するカードがあれば、テスト選択と最終報告に反映する。
- 性能事故・高負荷計算の変更では、機能テストの成功と性能回復の証拠を分けて報告する。
- 公開runtimeのJVM / Caddy resource profileを変えたら、image内の実効値、cgroup hard limit、runtime smoke、
  Playwright E2E、HTTP hard concurrency相当の負荷、limit / OOM event、peak headroomを同じimageで検証する。
  開発hostだけで採用せず、production target OS / architectureのCIを通す。
- 公開HTTP protocolを変えたら、edgeのHTTP versionだけで判断せず、公開listener、reverse proxy、API受信protocol、
  並列request時のupstream接続数を実runtime imageで検証する。
- 戦績分析の初回公開とresource影響変更では、private運用要件の本番同等resource/performance gateと
  timeout設定を満たすまでリリース可としない。
