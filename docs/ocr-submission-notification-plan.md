# MOM-24 OCR送出単位通知 — 実装・検証計画

状態: 実装・ローカル検証・資材回収を完了。本番適用は未実施。合意仕様は[レビュー・仕様](ocr-submission-notification-spec.md)を参照する。
本書は工程と実行結果、検証資材の管理、停止切替・復元条件を定める。本番適用・実Discord投稿は本作業に含めない。

## 0. レビュー結果と変更した前提

利用者の指定により、メンテナンスで旧処理を収束・停止して一括切替する。
旧Web/API/Workerとの混在稼働、旧OCR通知の新規受付・再配送を支える恒久互換層は作らない。
既存データの保全と、今回変更しない分析通知の現行契約は維持する。
メンテナンス宣言を予定していることは、今回のレビュー中に本番操作を開始する指示ではない。

**計画レビュー時の判定:** 前案の責務分担は妥当。ただし、そのまま実装可能な確定計画とは言えない。
切替・wake・受付保護・test seamに以下の不足があった。改訂後はP0の成立確認を最初の停止条件とする。

| 重要度 | 前案の反例・過不足 | 改訂 |
| --- | --- | --- |
| 高 | メンテナンスを選んでも新旧併存、optionalな旧request、旧rendererを残すと維持対象だけが増える。 | 切替後のOCRは送出必須・通知v2だけにする。未終端の旧OCR処理・配送は切替前に排出する。 |
| 高 | 旧通知は保存済みでも再配送時にvalidatorを通る。FAILEDを手動retryすると廃止した形式が復活する。 | 旧OCRの未終端を残さない開始条件と、保存済み旧OCRのinspect/retry/claimでの再送拒否を定める。履歴は消さない。 |
| 高 | 「新payloadを読めるconsumerだけ残す」では全体rollbackにならない。再開後に旧backupへ戻すと新規記録が消え、Discord送信も取り消せない。 | 全体復元が可能な段階と、新しい業務書込み・外部副作用後のforward fixを分ける。DB・queue・object・全consumerを同じ基準で扱う。 |
| 高 | idle中の最初のwakeを失った場合、openを知っている間だけの再確認では発見できない。先頭の処理中送出だけをLIMITで取り続けても後続が進まない。 | LISTEN先行、起動/再接続scan、idle時も低頻度の安全走査、公平なkeyset巡回を持つ。恒久通知outboxは増やさない。 |
| 高 | 送出は画像jobが0件でも作れるため、既存のactive job上限だけでは未確定送出の増加を制限できない。 | 認可・既存rate limitに加え、主体別のopen送出上限を原子的に判定する。同じ操作の照会・再送は新規枠を消費しない。 |
| 高 | uploadが失敗した事実とmemberの最終失敗を同一視すると、再試行可能な画像を閉じる。job登録前の画像は現行の生存参照にも含まれない。 | 失敗の分類とupload受付識別の照合を先に確定し、期限までの参照保護を検証する。 |
| 中 | 下書きは物理DELETEされる。単純なFK/CASCADEは削除を妨げるか、送出の終端識別を消す。 | sourceの識別保持と物理参照を分け、実際の取消commandを通してDDLを検証する。全columnにFKを置くことを目標にしない。 |
| 中 | P3が未実装のP4 producer fixtureを必要とする。最終E2Eで初めてfake childやDiscord差替えが成立するか確かめるのも遅い。 | wire encoderとvalidatorの接続、runtime起動・注入可能性をP0の小さな実証へ移す。 |
| 中 | 8系統のbrowser E2Eに厳密な停止点・DB raceまで載せると、試験基盤が機能より大きくなる。 | browserは利用者操作の代表4系統と実native接続の代表確認に絞り、競合・設定race・crashは実DB/runtimeへ置く。 |
| 中 | 実在を確認していない「既存job保持処理への接続」や新規の詳細圧縮を必須にしている。 | 今回は実在する画像回収の保護と、薄い送出識別の保持まで。新たなarchive/圧縮schedulerは追加しない。 |

確認した実行経路:

- [Summitの再配送時の再検証](../../summit/src/scheduler/resultNotifications.delivery.ts)と
  [旧FAILEDもretry可能な現行state処理](../../summit/src/db/repositories/resultNotifications.state.ts)。
- [active job数だけを数える受付](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresOcrJobCreationStore.scala)、
  [upload予約・参照判定](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresSourceImagesRepository.scala)、
  [物理削除を行う下書き取消し](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresMatchDraftCancellationRepository.scala)。
- [別transactionで合図を送る既存notifier](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresSeriesAnalysisOutboxNotifier.scala)、
  [実launcherを組み立てるsupervisor](../apps/processing-worker/src/supervisor.rs)、
  [注入可能なOCR consumer境界](../apps/processing-worker/src/ocr/consumer.rs)。

software-design-philosophyの8診断による計画時点の暫定評価は6/8、7.5/10。
未達は「interfaceが実装より簡単」と「内部変更をcallerへ波及させない」の2点で、
前者は試験用制御を既存port/test entryへ閉じること、後者は保存契約と停止切替条件を固定することが必要。
この修正を計画へ反映したが、P0の実証前に実現性確認済み・10/10とは評価しない。

## 1. 実装方針と依存順

1. **P0: 契約と実現性を固定する。** DDL、API、lock順、期限を具体化し、wireとtest seamを小さく実証する。
2. **P1: momo-dbの保存構造を追加する。** 業務判断を入れず、必要な追加migrationを作る。
3. **P2: APIの送出受付を実装する。** これと独立に、P0/P1の契約に沿って**P3: SummitのOCR v2受付**を実装できる。
4. **P4: Workerの送出確定処理を実装する。** P1・P2の保存契約とP3の受信契約へ接続する。
5. **P5: Webの読み取り操作へ接続する。** 同一操作の再試行と新規操作を区別する。
6. **P6: 組合せE2Eと停止切替を確認する。** 検証環境の準備はP0から設計し、P2〜P5で必要な部分を作る。
7. **P7: 必須gate、資材回収、導入手順を確認する。** 工程ごとの検証結果を再利用し、最後に一律で再実行しない。

momo-dbの担当はschema・migration・構造型・宣言的制約までとする。終了判定、通知設定の解釈、
受付期限、本文生成、scheduler、業務transactionの組立ては追加しない。
通常の全体確定はWorkerの単一commandに集約し、APIから通知を生成・送信しない。

各工程では、その変更に対応するtestも同時に実装・実行する。E2Eまで不具合の発見を先送りしない。
新しい汎用workflow基盤、producer通知outbox、通知専用の追加配送tableは作業対象に含めない。
DB変更は必要な追加を基本とするが、旧consumerの稼働互換を合格条件にはしない。
互換性が不要であることを、既存tableの削除や分析通知のversion変更を行う理由にもしない。

### 1.1 固定した実装契約

- schemaは`ocr_submissions`と`ocr_submission_members`の2表。送出IDは小文字UUID、ownerはログインaccount、下書きIDは削除後も再送照合できるようFKを持たない。memberは画像種別・upload key hash・SHA-256・byte長・登録jobまたは受付失敗を保存する。request hash、現在slotの複製、完了counter、通知outboxは追加しない。
- `PUT /api/ocr-submissions/{submissionId}`で`matchDraftId`、`ocrHints`、固定membersを保存し、同URLのGETで状態を取得する。job POSTは`submissionId`、`requestedScreenType`、`imageId`だけとし、下書きとヒントはheaderから取得する。詳細は生成OpenAPIを正本とする。
- 受付期限は10分、accountごとのopen上限は4。最大3枚・各3MiBの転送と明示retryの余裕を持たせつつ、未受付操作が無制限に残るのを防ぐ初期の設計値である。OCR完了時間のSLAではない。期限は再送で延長しない。
- coordinatorは1ページ32件を上限として巡回し、30秒の安全走査と保存受付期限を併用する。初回route/schema検証後の接続喪失は有界backoffで接続を交換し、LISTEN後に未確定だけを再走査する。1件のtimeoutで後続が飢餓にならないようcursorを保持する。既存OCRの確定時間予算を再利用し、別のOCR期限は追加しない。
- OCR wireはv2、`sourceJobId=submission:<UUID>`、通知IDは`result:ocr_completed:submission:<UUID>`。failuresは固定画面順で0〜3件。理由は`admission_failed` / `admission_timeout` / `ocr_failed` / `ocr_timeout` / `cancelled`。分析wire/rendererは1、新OCR rendererは2。共有JSON例をRust encoderとSummit validatorの両方で照合する。
- 送出PUTの前は下書きを`draft_ready`とし、受付が失われても編集可能にする。空の初回下書きだけ受付transactionで`ocr_running`へ移し、既存結果slotはjob登録まで維持する。job0で確定するときも後の送出/結果を上書きしない。

| writer | lockと更新の順序 |
| --- | --- |
| 新規送出受付 | account枠・送出identityのadvisory → draft → 既存source image → header/member挿入。既存replayはheader読取lockで内容照合して返す。 |
| 新規job登録 | global job枠 → draft → submission → source image → 新job/OCR draft/member/queue intent。既存memberのreplayは新規枠を使わない。 |
| 受付の恒久拒否 | draft ID順 → submission ID順 → 対応pending memberだけ更新。uploadのstorage transactionを持ったまま呼ばない。 |
| OCR完了・失敗・中止・保守 | 既存execution slot / draft / jobの順を保つ。終端を不変にし、各writerへsubmission lockを増やさない。 |
| 送出確定 | draft → submission → 別statementで固定member/job読取 → 終端更新 → 最後に通知gate/設定。画像execution slotは取らない。 |
| 下書き確定・削除・親削除 | source業務行 → submissionのaborted化 → 最後に通知gate・未開始通知取消。 |
| 設定変更・通知受付/配送 | 共有通知gateを使い、その後source業務行を更新lockしない。 |
| 画像保持 | 既存source image lockと参照guard。pending memberはowner/key/hash/sizeを照合して保護し、headerを更新lockしない。 |

## 2. 工程別の実装内容と完了条件

### P0: 契約と反例を固定する

- [x] 3 repositoryの規約、作業tree、対象revision、依存pin、migration履歴を確認する。
  DB編集・操作の前に[momo-dbの正規開発手順](../../momo-db/docs/development.md)を全文確認する。
  各repository固定のtoolchainを使い、pnpmのversionを横並びに揃えない。
- [x] header/memberのcolumn、native制約、参照先、index、削除時の扱いを確定する。
  headerに未確定検索と受付期限検索の入口を置き、member→jobを不変にする。
  現在の下書きslot、完了件数counter、通知送信済みflagを集約の正本にしない。
  下書きIDは削除後も照合できる不変の識別として残す。FKは生命周期が一致する関連に置き、
  下書き削除・失敗画像回収を妨げない。jobの終端状態が再びrunningへ戻らないことも確認する。
- [x] 受付API案を確定する。第一候補は`PUT /api/ocr-submissions/{submissionId}`による
  全memberの一括受付と`GET /api/ocr-submissions/{submissionId}`による照会。
  既存job作成へ送出IDとmember識別を必須で追加する。欠けた旧requestは副作用前に拒否し、
  既に開いている旧Webも更新を要することを切替案内・API errorで扱う。
  request/response、認可、CSRF、受付上限、同一ID異内容の拒否、終了済み枠への応答を定義する。
  送出状態と、画像job・下書き編集可否の状態は分けて返す。
- [x] 操作IDの照合対象を固定する。主体、下書き、対象画面種別、読取り条件、member受付識別を含め、
  ファイルを差し替えて同じ操作IDを再利用できないようにする。upload/jobの既存idempotencyと
  接続し、HTTP記録の保持期限を過ぎても二重受付させない。
  job登録前でもmemberとupload受付識別を照合できる保存契約を定め、画像の孤立回収との競合を防ぐ。
  既存uploadの主体・idempotency hash・内容digestを利用できるかを先に確認し、独立した画像予約基盤は増やさない。
- [x] 主体別open送出数の上限とguard順を定める。送出受付時に既存rate limitと認可を通し、
  同じ主体の同時受付でも上限を超えない。domain replayは新規quota判定より先に既存結果へ収束させる。
- [x] 確定的な受付拒否を保存できる経路を決める。サーバーが確認できない転送失敗や応答喪失は
  未受付のまま照会・期限へ収束させる。クライアントの失敗申告だけで閉じるAPIは追加しない。
  一時的な混雑・rate limit・upload再試行可能エラーはmember終端にしない。
  恒久拒否を早く閉じるのは主体/member/内容を照合できる経路だけとし、確証がなければ期限で収束させる。
- [x] 全writerのlock順を1枚の表にする。対象は送出受付、job紐付け、受付失敗、期限終了、
  OCR成功・失敗・中止・再試行、queue outboxの最終拒否、API stale reaper、下書き確定・削除、
  マスター経由の削除、設定変更、保持期間による整理。draft/source、submission、job等の取得順と
  通知gateの位置を現行SQLへ照合する。gate取得後に業務row lock/writeを追加しない。
  既存のquota guardとWorker execution slotも表に含める。coordinatorは画像execution slotを取らず、
  通常のjob完了writerに送出lockを無条件で追加しない。固定関連と終端の不変性で読める範囲を先に決める。
- [x] 受付期限、wake後の処理上限、再確認間隔、shutdown時の待機上限を選定する。
  受付期限は3枚の転送・照会・再試行の予算から決め、OCR処理期限と分離する。
  実装前に設定値と選定根拠を確定し、期限の直前・境界・直後を試験できるclock境界を用意する。
  定数を仮置きしたまま完了扱いにしない。
  通知ON/OFF判定は最後の画像commitでなく送出確定commitである、という合意仕様もこの時間予算に含める。
- [x] OCR v2の通知ID namespace、失敗分類、表示順、長さ上限、保存versionを固定する。
  Rustのwire encoderとSummit validatorの最小契約testを先に作り、同じfixtureを通す。
  P3が未完成の業務finalizerへ依存しないようにする。OCR v1新規受付・再送は廃止し、分析v1は現行契約として維持する。
  OCR Redis wireは保存済みmember→jobの関連で足りるなら変更しない。
- [x] 画像資材とE2E起動方法を確定する。既存の標準E2EはAPI・Web・DB・Redisまでで、
  WorkerとSummitを起動しない。P6の実通知経路を通す専用構成を準備する。
  実APIのuploadをWorkerが読めること、既存`OcrChildLauncher`の試験注入、Summit runtimeの
  実repository＋記録用Discord client、MCPの接続・終了を小さな試験で成立させる。
  supervisorは通常起動で実launcherを構築するため、差替え可能と仮定しない。
  OCR有効化に既存の分析runtimeが必要な点もbootstrapへ含める。

**完了条件:** API/DDL/wireの型案、writer別lock表、期限・再確認の設定、P6の資材一覧と保証範囲が
揃い、最小wire/test seamの実証が通る。成立しない箇所があればP1以降へ進む前に方式を縮小・再設計する。
DB業務関数や複数finalizerが必要という結論になった場合も、そのまま実装しない。
ここで残るものは技術的な選定であり、確定済みの通知単位・本文・ON/OFF方針は変更しない。

### P1: momo-db — 必要な保存構造を追加する

変更入口: [`src/schema.ts`](../../momo-db/src/schema.ts)、
[`src/notifications.ts`](../../momo-db/src/notifications.ts)、`drizzle/`、通知・migration保全test。

- [x] 送出header、固定member、job対応、終端識別を追加する。PK/UNIQUE/FK/CHECKと必要なindexで
  row形状と一意性を守る。複数rowの終了判定や通知可否はconsumerのcommandが扱う。
- [x] 新しい構造型を追加する。共有validatorを置く場合も形状・version・ID形式までとし、
  設定参照、DB query、終了policy、文面生成をexportしない。
- [x] `pnpm db:generate --name=<変更名>`で追加migrationを生成する。
  独立したcustom DDLが必要なら正規の`--custom`で分ける。journal/snapshotの手編集、
  `push`、共有・適用済みmigrationの書換えをしない。過去jobの推測による送出backfillは行わない。
- [x] 新規disposable DBへの全履歴適用と、代表的な旧データのbackup/restoreコピーへの
  tail適用を別に検証する。後者は既存通知payload・version・設定世代・配送状態・対象参照・件数を比較する。
  `web-e2e`用bootstrapをmigration保全検証の前提データへ混ぜない。
- [x] 制約違反と参照保護を実PostgreSQLで検証する。新testを別fileへ分けた場合は、
  package script/CIがそのfileを実行することも確認する。

**完了条件:** DB必須gateとfresh/復元コピーの保全試験が通り、対象の新consumerが同じ保存契約を使える。
既存の通知配送tableに追加機能を詰め込まずにv2を保存できることを確認する。

### P2: API — 固定集合の受付と各writerを接続する

主な変更入口は`apps/api/src/main/scala/momo/api/`の以下。

- `endpoints/OcrJobEndpoints.scala`、`http/modules/OcrModule.scala`と新設する送出endpoint/usecase。
- `usecases/ocr/CreateOcrJob.scala`、`adapters/postgres/PostgresOcrJobCreationStore.scala`。
- `PostgresOcrJobMaintenanceRepository.scala`、`PostgresOcrQueueOutboxRepository.scala`、
  `PostgresOcrJobsRepository.scala`、下書き取消・画像保持のrepository。

- [x] 認可済み下書きにheaderと全memberを原子的に作る。同じID・同じ内容は既存状態へ収束させ、
  他主体・他下書き・異なる内容・重複画面種別・空集合を拒否する。
  主体別open送出数のguardも同じ受付transactionへ入れ、同一操作の再送で枠を重複消費しない。
- [x] job作成、member紐付け、下書きへの反映、既存queue outboxを一つのtransactionで保存する。
  期限処理と同じ送出lockを使い、閉じた枠へ新jobを作らない。
- [x] 同一requestのcommit後に応答を失っても照会・再送で同じjobを返す。
  generic HTTP idempotencyだけに依存せず、業務上の一意性をrepositoryで守る。
- [x] 受付・最終受付失敗・APIによるjob終端変更のcommit後に、集約可能なwake hintを出す。
  既存notifierは業務transactionとは別に送信するので、hintは失われ得るものとして扱う。
  wake障害はOCR保存を失敗にせず、P4の安全走査で回収する。
  APIが送出の通常確定や通知payload生成を代行しない。
- [x] 下書き確定・削除時のaborted化と既存の未配送通知取消しを接続する。
  未確定送出が必要とするjob・画像参照を保持処理から保護する。
  upload済み/job未登録の画像も、照会・再試行可能な間に孤立扱いで消さない。
- [x] TapirからOpenAPIを生成し、Web型とエラー契約を更新する。新wireに応じて契約文書を更新する。

**完了条件:** 実DBの重複受付、応答喪失、期限競合、取消し、参照保持が通る。
API stale reaperとqueue outboxの拒否も含め、最後のwriterがWorker以外でも再確認へ到達する。

### P3: Summit — OCR v2へ置き換え、分析通知を維持する

変更入口: `src/domain/resultNotificationPayload.ts`、
`src/db/repositories/resultNotifications.receipt.ts`、
`resultNotifications.state.ts`、`src/scheduler/resultNotifications.delivery.ts`、
`src/features/result-notifications/{render,text}.ts`、`tests/contracts/`と通知integration test。

- [x] kind/versionの許可表をOCR v2・分析v1にする。旧OCRは重複IDの早期returnも含め、
  新規受付の対象にしない。P0のRust encoder出力を通し、P4で業務producerの実出力にも接続する。
- [x] envelopeのversionを保存列へ明示する。現行の既定値1に任せるinsertを修正する。
- [x] payloadのschemaVersionと本文のrendererVersionを分ける。新OCR用rendererを識別し、
  配送側の固定`rendererVersion === 1`前提と初回renderer選択を更新する。分析の描画・保存済みpartは維持する。
- [x] v2では完了案内・文脈・完了日時・下書きリンクと失敗だけを描画する。
  失敗0件と最大3件を扱い、成功・要確認の件数や警告を本文へ出さない。
- [x] エスケープ後の最大長、長い表示名の明示的省略、メンション抑止を検証し、必須情報を保って1投稿にする。
- [x] 既存の固定payload/本文、同一ID異内容拒否、世代取消し、下書き取消し、受付後再送を維持する。
  保存済み旧OCRのpayload・hash・identity・履歴は書き換えないが、inspectのretryableとretry commandの
  両方で再送不可にする。claimと次回dispatch時刻の検索にも同じ対応version条件を使い、
  未対応rowによる空回りを防ぐ。想定外の未終端残存は診断して切替を止める。
  旧OCR rendererを残す代わりに、第7節の旧OCR未終端0件と再送拒否を検証する。
  共用のclaim/dispatch queryを変える場合は、分析・他の通知familyの配送対象が欠けないことも確認する。

**完了条件:** fake/real repository契約、実DB受付・配送状態、renderer最大長、分析回帰、旧OCR拒否が通る。
HTTP harnessのfake repositoryだけでは永続受付・配送の証拠にしない。

### P4: Processing Worker — 全体確定の単一commandを追加する

変更入口: `apps/processing-worker/src/ocr/control.rs`とrecovery、`supervisor.rs`、
`notifications/{ocr,envelope,preparation}.rs`。送出coordinatorは`ocr/`配下の小さな専用moduleとして追加する。

- [x] `settleSubmission`を実装する。lock取得後の新しいsnapshotで固定memberと実jobを読み、
  未受付・queued/running・内部再試行中はopenを保つ。参照欠落を「全件終了」に変換しない。
- [x] 未受付memberだけを期限終了させ、openから一度だけsettledへ進める。
  取消済みsourceは通知を作らず閉じる。最後のjobや現在のslotから集合を推測しない。
- [x] 業務更新後の回復可能なSAVEPOINT内で通知gateを取得し、別statementで設定・世代を読む。
  ONなら失敗だけの固定v2 payloadをメモリへ準備する。準備失敗でも業務commitを維持する。
- [x] commit成功を確認した処理だけが既存の上限付きsenderへ渡す。
  送信中にDB transactionや画像計算slotを保持せず、画像ACKを通知HTTPへ依存させない。
  commit不明・HTTP失敗のproducer再送、settled送出からの再構築を実装しない。
- [x] 画像ごとの旧通知準備を削除し、coordinatorだけがOCR通知を生成する。
  切替後の新jobは送出所属必須。終端済み旧job/Redisの残存deliveryから新通知を作らない。
  未終端の旧jobが見つかった場合は切替前提違反として扱い、推測で新送出へ変換しない。
  envelope全体の定数変更で分析producerまでv2にしない。
- [x] OCR有効時は画像queue件数と独立にcoordinatorを起動する。LISTEN確立後に初回scanし、
  再接続後にもscanする。wakeと受付期限で早く再確認し、idle時にも低頻度の安全走査を行う。
  初回hint喪失、hint送信processの停止、合図が重複した場合もopenだけが収束する。
- [x] 上限付きkeyset巡回でopen全体を一巡し、処理中/不整合/lock待ちの1件が後続を阻まないようにする。
  期限到来分を拾い、cursorの循環と新規到着を扱う。1件ごとに短いtransactionと時間上限を持つ。
  画像計算slotを消費せず、idleの短周期走査と無制限task生成を避ける。停止時のlistener/timer/taskを回収する。
  参照不整合は診断可能にし、単一送出の回復可能な失敗で全coordinatorやOCR計算を停止しない。
  設定不整合など起動不能な問題と、再接続・再判定できる失敗を区別する。
- [x] 未確定のjob対応と期限内uploadを既存画像回収から保護する。
  薄いheader/memberは保持し、source削除で終端識別を失わない。新しいarchive/圧縮schedulerは作らない。
  将来詳細整理を加える場合は、domain replayと最小識別保持の契約を満たす別変更として扱う。

**完了条件:** 実DB・RedisとLinux runtimeでP4の状態遷移、競合、復旧、非占有が通る。
「全体確定」はcoordinatorの終端commitであり、Worker停止中の最後の画像終了ではないことを確認する。

### P5: Web — 操作単位と再試行を接続する

変更入口: `apps/web/src/features/ocrCapture/`の`ocrSubmissionWorkflow.ts`、
`ocrSubmissionPlan.ts`、`useOcrCaptureMutations.ts`、`useOcrStartFlow.ts`、slot/status表示と
`apps/web/src/shared/api/`。既存workflow・dialog・captureのtestを拡張する。

- [x] 読み取り開始時に対象集合と送出IDを固定し、送出受付後に各画像のupload/job作成へ進む。
  既存の画像checkpointへmember対応を追加し、フォーム変換後も送出IDをrequestへ残す。
- [x] 結果不明時は送出状態を照会して同じ操作を再試行する。黙って新規IDへ切り替えない。
  期限終了後の再読み取り、後の追加・画像差替えは明示的な新しい操作として扱う。
- [x] 各画像の転送状態と送出全体の状態を区別する。画像処理終了だけで全体完了を先取りしない。
  通知待ちを理由に下書き編集・確定を余計に止めず、全失敗後も再読み取り・手入力へ進める。
- [x] pendingの重複操作、局所error/retry、accessible name、keyboard/focusをcomponentで確認する。
  query cache・再照会から復帰したときに古い通信errorを表示し続けない。

**完了条件:** 同一操作の通信再試行、別操作の追加、期限終了、全失敗からの復帰がUI操作で成立する。

## 3. 検証の配分

[テスト規約](test-rule.md)、[テスト構成](test-architecture.md)、
[Change Gates](dev-rule.md#4-change-gates)、[UI検証](ui-rule.md#9-検証)に従う。
同じ反例を全層へ複製せず、実際に壊れる境界を主たる証拠にする。

| 証拠を取る場所 | 主なケースと判定内容 |
| --- | --- |
| pure/component | 操作ID維持、対象集合固定、request変換、局所errorからの復帰、安全な失敗分類、文面・最大長。呼出回数だけでなくrequestと利用者が見る結果を確認。 |
| API/usecase・契約 | 同一IDの同内容/異内容、権限違反、重複種別、空集合、終了済み枠、open上限、一時失敗後のretry。旧requestがjobを作らず拒否されることも確認。 |
| 実PostgreSQL | 同時finalizer、最後の2jobの同時終了、job登録対期限、確定対設定変更/下書き削除、rollback/commit不明、保持処理との競合。別connectionとbarrierで順序を制御し、保存row・関連・世代・通知effectを確認。 |
| 実DB・Redis | API stale reaper、outbox最終拒否、画像0件、内部再試行、重複delivery、idle時の初回wake喪失/再接続、公平な巡回。openだけが収束し、settledから通知を再構築しない。 |
| Linux Worker | production Dockerfileのimage、実child/native境界、終了・復旧、遅い通知時のACK/slot解放、既存preemption。macOS host binaryの成功で代替しない。 |
| Worker → Summit | producerの実出力をreceiver/validatorへ通し、version列、固定payload、通知ID、同一ID異内容拒否、旧OCR拒否・分析v1維持を確認。 |
| Summit実DB | 受付後の配送再試行、OFF/世代変更・source取消し、固定本文保持。外部Discordの厳密なexactly-onceをassertしない。 |
| migration/停止切替 | 空DB全履歴、旧データ復元コピーのtail、制約/index、通知履歴・設定・配送状態保持。未終端の旧OCRが残れば停止し、baseline復元で旧一式が再開できることを確認。 |

競合はbarrier/deferred/制御clockで再現し、偶然のsleepで作らない。期限の前・一致・後、
APIが最後を終えた場合、全画像受付失敗、全画像OCR失敗を別の反例として扱う。
通知準備timeout・容量不足・DB error・HTTP failureでもOCR結果と下書きを利用できることを確認する。
PostgreSQLによるwakeは、業務commit後の通知requestから別connectionのlistenerまで通し、
接続形態に依存する部分を直接接続の成功だけで保証しない。

## 4. P6: E2Eの構成とシナリオ

### 4.1 起動するものと代替境界

既存[`e2e-isolated.mjs`](../apps/web/scripts/e2e-isolated.mjs)の隔離・起動・終了管理を再利用し、
今回必要な構成だけを追加する。通常E2Eへ常に全service起動を強制しない。

- 専用PostgreSQL 18、Redis、画像保存先、実API、Web、LinuxのWorker runtimeを用意する。
  Web/APIは検証対象revisionからbuildし、fresh E2Eは`web-e2e` profileで初期化する。
- Workerはobject storage経由で画像を読むため、既存E2Eのローカル画像directoryだけを渡して
  結線済みと扱わない。試験専用のobject storage境界を用意し、APIの保存からWorkerの取得まで
  同じobject key・checksum・サイズで通す。loopback等の既存接続制約を弱めずに構成する。
  ここで使う代替は実providerの認証・network動作の証拠にはしない。
- Summitは[`createResultNotificationRuntime`](../../summit/src/notifications/runtime.ts)と
  実PostgreSQL repositoryを使い、HTTP受付、保存、renderer、dispatcherまで実装を通す。
  Discord clientの最終送信境界を、本文・投稿数・送信結果を記録できる試験用portへ置き換える。
  fake repositoryだけの既存HTTP harnessは、このE2Eの代わりにしない。
- Summitの通常`dev`/`start`を起動しない。試験用entryから必要なruntimeだけを構築し、
  bot login・command sync・実channelへの投稿を発生させない。
- 遅延・失敗・要確認の組合せには既存`OcrChildLauncher`を利用するtest専用entryを使う。
  queue consumer、実DBへの結果commit、coordinator、senderは実装を共有する。
  これは「制御childを使った組合せE2E」であり、production imageそのものの検証とは区別する。
- 別にproduction imageの実native childから通知まで通る代表1ケースを確認する。
  APIが受理する合成画像で所定の最終失敗を再現できれば、この接続確認に利用できる。
  読取り精度の評価を今回の新規課題へ広げない。private画像datasetを自動で流用しない。
  production設定で任意のOCR結果・通知状態を注入できる機能は追加しない。

実native画像を用意できない場合も他の検証は進めるが、その境界は未検証とし、
制御candidateの成功をOCR精度・native実行の成功として報告しない。

### 4.2 操作方法と証拠

- [x] repository規約に従い、**ブラウザでのE2E実確認はPlaywright MCPを使う**。
  専用環境を起動・保持・停止できるようにし、MCPが対象Webへ接続して操作する。
  既存CLI runnerが先に環境を破棄する形や、普段使いの開発serverへの接続にしない。
- [x] 同じ主要シナリオを`apps/web/e2e/`へ回帰testとして残し、CIのPlaywright suiteへ含める。
  CLI回帰gateの成功とMCPによる実確認を、それぞれの証拠として記録する。
- [x] locatorはrole/name/labelとtest-ownedな業務IDを使う。既存`e2e/support.ts`同様、
  run・worker・retryごとに別IDを発行する。以前のattemptの通知を今回の成功に数えない。
- [x] browserのrequest/画面、送出/member/jobのDB状態、Summit受付rowのversion/identity、
  記録用送信先の投稿数・本文・リンクを送出IDで突合する。screen shotは補助にする。
- [x] 「まだ通知されない」は遅いmemberのbarrier到達とcoordinatorの再確認完了を待って判定する。
  「追加されない」は対象処理の収束・drain後に判定する。短いsleep中の0件だけを根拠にしない。
- [x] 通知設定は全体共通なので、同じDBで変更するケースは直列に実行する。
  並列化する場合はDB・Redis・保存先・receiverを含めて別環境へ隔離する。
- [x] 変更した状態表示とretry操作を代表desktop・狭幅で確認し、keyboard、focus復帰、
  pending/確定/errorの区別、意図しない横scrollを確認する。近いviewportの総当たりは行わない。

### 4.3 ブラウザから通す代表ケース

| ID | 操作・制御点 | 合格条件 |
| --- | --- | --- |
| E1 | 3枚を1回で送出。1枚を遅延させ、残りを成功/要確認にする。最後も終了させる。 | 途中は0投稿、全体確定後は1投稿。成功・要確認の一覧/件数なし。下書きリンクが開く。 |
| E2 | 一部OCR失敗、続いて別送出で全OCR失敗を実行する。 | 各送出1投稿。失敗の種別と安全な理由だけが固定順に並ぶ。全失敗から下書き編集/再読み取りに進める。 |
| E3 | job作成commit後の応答を落として画面から再試行。その後、APIで同じ下書き・同じ種別を新送出として読み取り直す（既存画面にない再読取UIは追加しない）。 | retryは同じ送出/member/job、新操作は別IDへ収束。各送出1通知で、過去の集合・本文が差替え後のslotに影響されない。 |
| E4 | 送出受付後に全uploadを未受付のまま止め、browserを閉じる。期限後に下書きが編集可能なことを確認し、APIで新送出を行う。画面を保持した期限終了は既存dialogの明示再送も確認する。 | jobが0件でも期限終了で1投稿。試験側が保存した送出IDでGET結果を確認し、再読み取りは新IDになる。 |

E1〜E4のうち、設定画面からON/OFFを保存・再表示するbrowser経路も代表1回通す。
設定競合やcrashの停止点を全てbrowserへ載せず、次の実DB/runtime testで固定する。

| ID | 制御する境界 | 合格条件 |
| --- | --- | --- |
| R1 | 確定前OFF→ON、OFF確定後ON、全member終了後coordinator再開前の設定変更 | 確定transactionの設定で対象が決まり、OFF確定分は補完されない。 |
| R2 | Summit受付後・配送開始前にOFF→ON、下書き確定/削除 | 未開始配送は取消され復活しない。開始済み送信の現行境界を変えない。 |
| R3 | openのまま再起動、終端commit後・HTTP前で停止、HTTP受付不明 | openだけ回復。settledからの通知再構築・producer再送がない。OCR保存は保持。 |
| R4 | idle時の最初のhint喪失、listener再接続、先頭に長時間未終了の送出がある巡回 | queue画像0件でも安全走査で発見し、後続も処理される。処理量・task数は上限内。 |
| R5 | 旧OCR v1 payload・旧FAILED retry・旧job request、現行分析v1 | 旧OCRのjob・通知を新たに作らない。先行uploadがあっても既存回収へ収束。履歴保持と分析通知の既存契約が成立。 |
| R6 | 旧状態からの切替と復元、旧pending残存、新規業務書込み後のrollback要求 | 第7節の開始・再開・復元条件を機械的に判定でき、不成立なら処理を停止する。 |

厳密なDB raceは第3節とR1/R2へまとめる。試験用barrierはtest entry/既存portに置き、
production用の外部操作endpointを増やさない。最大文面長はrenderer契約で固定する。
E4のために送出履歴画面や選択fileの永続保存を追加する必要はない。

最後のmember終了→全体確定と、全体確定→通知受付・送信を別々に計測する。
到着までの時間だけでcoordinatorの遅延を隠さず、P0の時間予算に対して確認する。
実測値や個別失敗ログは公開仕様へ転記しない。

実Discord到着、実providerの保存・認証、Discord OAuthはこの隔離E2Eでは未検証である。
live確認が必要になった場合は、対象・送信内容・件数・片付けを具体化して別に実施範囲を確認する。
本計画だけで実channelへの試験投稿や本番変更を開始しない。

## 5. 必須gateと実行への組込み

commandは各repositoryのmanifest/build設定を正本とする。以下は今回の変更に適用する実行予定。
API qualityやmigration履歴checkだけを動作確認の代わりにしない。

| 実行場所 | gateと今回の追加確認 |
| --- | --- |
| momo-db | `pnpm build`、`pnpm db:check`、専用DBで`pnpm test:prepare`・`pnpm test:integration`・`pnpm test:migrations`。fresh/復元コピーの両方を含める。 |
| momo-result / apps/api | `sbt apiQuality`と対象unit/contract test、`sbt apiDbQuality`、`sbt apiRedisQuality`。画像保持・storage境界を変更する場合は`apiR2Quality`とreconciler readinessも実施。 |
| API/Web生成 | `apps/api`で`sbt apiOpenApi`、rootで`pnpm --filter web generate:api`・`pnpm --filter web contract:check`。生成物は手編集しない。 |
| momo-result / Web | rootで`pnpm --filter web format:check`・`lint`・`typecheck`・対象`test:run`・`build`。主要OCR flowのPlaywright MCP確認とCI回帰。 |
| momo-result / Worker | worker directoryで`cargo fmt --all -- --check`、`cargo clippy --locked --workspace --all-targets`、対象`cargo test --locked --workspace`。必要なnative依存を揃えたLinuxでproduction imageをbuildする。 |
| Worker実境界 | `scripts/ci/ocr-rust-control-plane-smoke.sh`、`processing-worker-image-smoke.sh <image>`、`processing-worker-preemption-smoke.sh <image>`。共通sender/envelope/supervisor変更に影響する分析通知・control-planeの回帰も実施。 |
| Summit | `pnpm run ci`、対象contract test、専用DBの`pnpm test:integration`。`pnpm ci`とはしない。新wire・旧OCR拒否・分析回帰・保存version・renderer・取消し・配送再試行を含める。 |
| scripts/workflow | harnessの部分起動失敗・中断・cleanup失敗を制御して検証。workflow変更には`pnpm actionlint`、Dockerfile変更には対応lint、runtime/deploy変更には規約のbuild/scan/runtime gateを追加。 |
| 文書 | `git diff --check`、`pnpm public:safety:check`、追加した参照先の実在確認。 |

新しいWorker integration testをignoredにする場合は、既存smokeの実行対象へ明示追加する。
Summit/momo-dbでもfileが増えただけでscriptから漏れていないか確認する。
固定schema/wire fixtureはproducerからconsumerへ渡し、両側で別々に都合のよい期待値を手書きしない。

CIの必須suiteは所定の単位で通す。適用対象が通った後の追加実行は、新しい変更・失敗・
具体的な未解決事項がある範囲に限る。retryで通った場合も初回失敗とattempt別の証拠を記録する。

## 6. 検証資材の作成とクリーンアップ

### 6.1 作成前の管理

- [x] temporary rootを実行ごとに作り、`MOM24_WORK_ROOT`等の専用変数で参照する。
  run ID、作成したresource ID、process/container、path、revision、回収状態をmanifestへ記録する。
  manifestへsecretや接続URLの実値は書かない。
- [x] clean作業コピーが必要な場合は、所有する一時root配下に3repositoryをsibling配置する。
  追跡fileと今回の明示した新規fileだけを含め、ユーザーの未追跡configや`private/`を探索・複製しない。
  `file:../momo-db`依存もこの配置で解決する。
- [x] momo-dbの`db:*`は`.env.local`を読むため、元の設定を流用せずcleanコピーへ試験専用設定を作る。
  Summitのdocs検査も未追跡YAMLを探索するため、未承認configがある作業treeでは同じ方式を使う。
  接続値は専用processへ最小限だけ注入し、ログへ出さない。
- [x] fixtureは合成・公開可能な画像と代表データを優先する。旧DB保全試験は専用DBで代表旧データを作り、
  backup/restoreする。普段使いのDBや本番dumpを検証資材として読み込まない。

### 6.2 資材ごとの回収

| 資材 | 作成・隔離 | 終了時の回収 |
| --- | --- | --- |
| DB・復元コピー・template DB | run所有のdisposable DB/専用container。既存named volumeは使わない。 | 全consumerのpoolを閉じてから所有DB/containerを削除。backupと比較用dumpも検証完了後に削除。 |
| Redis・画像object・画像file | 専用Redis、bucket相当またはrun prefix、temp directory。 | producer/consumer停止後、所有namespace/object/container/directoryだけを削除。 |
| API・Web・Worker・Summit・送信記録port | run別process group/container/port。listener・timer・proxyも登録。 | 新規入力停止、runtime stop/drain、pool/listenerをcloseし、所有processを終了。上限超過は所有processだけを強制停止。 |
| race/barrier・失敗注入資材 | test lifecycleに閉じたclock、proxy、child fixture。 | `finally`でbarrierを解放し、taskを終了。production buildへの混入を確認。 |
| browser | 試験専用context/tab/storage。 | 証拠採取後に所有context/tabを閉じ、試験storageを破棄。利用者の既存tabは操作しない。 |
| test env・temporary作業コピー | 制限した権限のtemp file、専用root。 | process終了後に削除。元repositoryの未commit変更や既存envは変更しない。 |
| image tag・network・volume | 今回作成したものをID/labelで記録。 | 検証完了後に所有tag/network/volumeを回収。共有build cacheや利用者の既存imageを一括削除しない。 |
| trace・screen shot・送信記録・log | run/attempt別の非追跡directory。credential・実利用者の元画像・生の例外payloadを残さず、必要箇所をマスクする。 | 失敗解析と必要な報告が済むまで保持し、解消・要約後にローカル一時資材を削除。CI artifactは既存保持設定に従う。 |

### 6.3 中断・失敗でも回収する

1. 作成成功直後に所有manifestへ登録する。部分起動失敗でも作成済み資材を把握できるようにする。
2. 正常終了・例外・SIGINT/SIGTERMを同じ冪等cleanupへ接続する。
3. 先にproducerとbrowser操作を止め、Worker/Summitを停止・drainし、DB/Redisを最後に破棄する。
   shutdownで止まるtest用barrierはその前に解放する。
4. 一つの回収が失敗しても残りを試す。失敗を握り潰さず、残ったresource IDと再回収手順を記録し、
   cleanup未完了として報告する。強制終了後はmanifestから所有資材だけを回収する。
5. 最後にprocess、container、DB、object、temp pathの残存を照合する。
   wildcardのDB削除、global prune、通常環境の`docker compose down -v`は使わない。

永続する成果物は実装・migration・再現可能なtest/fixture・必要なdocsである。
一回限りの実行資材と分け、cleanupで成果物を削除しない。実装の保持処理もP2/P4で検証し、
試験用DBを消せたことを未確定送出の参照保護の証拠にはしない。

## 7. P7: メンテナンス中の一括導入とrollback

本節は公開可能な順序と判断条件を定める。実環境の接続値・操作command・配置・backupの所在は記載しない。
実際の本番適用は[運用規約](ops/README.md)の対象・範囲に従う。
DB ownerの[停止切替・復元手順](../../momo-db/docs/development.md)を使い、migrationの履歴を書き換えない。

### 7.1 メンテナンス前に完成させるもの

- [x] P0〜P6のローカルgateとMCP確認、R6の隔離した停止切替/復元rehearsalを終える。
  旧状態→新状態→旧baseline復元をdisposable DB・Redis・object資材で実行する。
  旧pending/activeが残る場合に進めないこと、新規業務書込み後に単純復元を拒むことも試す。
- [ ] DB/API/Worker/Web/Summitの対応revision、migration順、検証済みartifact、旧一式の復元候補を固定する。
  build済みartifactを再利用し、本番停止後に設計やbuildを始めない。
  CIの自動deploy/migrationが停止順序を追い越さないことも確認する。
- [ ] 旧処理の排出、backup/restore確認、切替、再開判定の時間予算と担当を決める。
  制限内に排出できない場合は切替を中止して旧一式を再開する。未完了job/通知を黙って削除・成功化しない。
- [x] 要求・業務状態・責務・保存/wireの各正本を更新する。
- [ ] 公開時に分割PRと依存pinを相互参照する。通常momo-result PRのbaseは`develop`。一部のmergeでMOM-24完了扱いにしない。

### 7.2 排出・停止・保全

1. 利用者のメンテナンス宣言後、新しい利用者書込みを止める。
   旧APIの受付済みrequest/uploadを収束させ、旧Worker・必要な保守処理・Summit配送だけで
   既存処理を排出する。これはschema切替前の旧一式による排出段階である。
2. **切替開始条件**を保存状態から確認する。旧OCRのqueued/running、再試行予定、未配送queue intent、
   有効な実行claim、upload受付処理が残っていないこと。旧OCR通知はPENDING/IN_FLIGHT、配送再試行予定、
   生存中の送信処理を残さない。queue長だけで判断せずDB状態・outbox・実行中processを照合する。
3. DELIVERED/FAILED/CANCELLEDの旧OCR履歴は保存する。旧FAILEDは新一式では手動再送不可となる。
   FAILEDに送達不明の記録があってもDELIVEREDへ偽装しない。旧OCRを新送出へbackfillせず、
   未配送を無断で一括取消しして開始条件を満たしたことにしない。
4. API、Worker、Summitのscheduler/bot処理、保守・cleanup・batchなど共有状態を書き換える全writerと
   外部配送を停止する。分析など今回変更しない処理も、backupの一貫性に影響するwriterとして扱う。
   旧instanceの再起動・残存接続・新たな書込みがないことを確認する。
5. 停止後の**baseline**を保全する。DBの復元可能なbackup、migration ID/hash、保全対象ID・値・参照、
   queue/consumer groupの対応状態、参照される画像objectと旧artifactを対応付ける。
   DBだけ過去に戻し、新queueやobject削除だけ残す復元をしない。objectの削除処理も止める。
6. backupの復元コピーが読めることを確認してからschema切替へ進む。
   終端済みjobのstaleなRedis entryは既存のfence/ACK方針で扱い、全Redisの初期化はしない。

### 7.3 一括切替と再開判定

1. 全writer停止中に正規migrationを適用する。対象DB・履歴のpreflightが違えば停止する。
   変更は送出構造の追加を中心とし、旧版維持のための二重書込み・条件分岐は追加しない。
2. 対応するAPI/Worker/Web/Summitを一式配置する。旧・新を混ぜて利用者requestを受け付けない。
   未終端の旧OCR job/通知がないことと、保存済み旧OCRのretryが不可となることを再確認する。
3. 保全対象の件数・値・参照・通知設定世代・履歴をbaselineと比較する。
   本番での事前検査はread-onlyを基本とし、書込みを伴う動作確認は隔離した復元コピーで行う。
   通常起動のbackground処理もwriterであり、メンテナンス画面が出ているだけで停止中とみなさない。
4. **再開条件:** migration完了、データ保全、全artifactの一致、旧稼働instanceなし、coordinatorと
   通知受信・配送の起動条件、旧Webからのjob request拒否、rollback候補の準備が揃うこと。
   条件を満たしてから新一式のwriterを開始し、稼働確認後に利用者受付を再開する。
5. 再開直後に送出の収束、重複通知の有無、OCR結果保存、取消し、背景処理の異常を確認する。
   通常利用の観測と、実Discordへ意図的に試験投稿する操作は区別する。
   新しい正規の業務書込み・外部送信が始まった時点を記録する。これは利用者受付再開より前の場合もある。

### 7.4 rollbackの分岐

| 失敗時点・条件 | 実施する回復 | 実施しない操作 |
| --- | --- | --- |
| schema切替前 | 排出/停止を中止し、同じ保存状態で旧一式を再開する。停止中の書込み欠落がないことを確認。 | 未完了job/通知の破棄。 |
| schema切替後、新しい正規業務書込み・外部副作用なし | 全writer停止を保ち、baselineのDB・queue/object対応と旧artifact一式へ復元。ID・値・参照と旧起動を照合後に再開。 | 新旧consumerの混在、migration履歴だけの削除、未検証のcodeだけのrollback。 |
| test-ownedな書込みだけで、外部送信なしと証明できる | 現状態も保全し、差分が検証資材だけであることを確認したうえで上記の全体復元を選べる。証明できなければ次行として扱う。 | shared設定世代などの業務変更を「試験だから」と無視すること。 |
| 新しい正規業務書込み、受付済み送出、新規upload、外部送信のいずれかあり | 再度全writer/配送を止めて**現状態**をbackupする。新データを保持するforward fixを第一選択にする。旧一式へ戻すには新状態の保全・変換・再開方法を別途検証し、その対象で判断する。 | 古いbaselineの上書き復元、新送出を旧画像通知へ自動変換すること、DB復元でDiscord送信を取り消せるとの扱い。 |

互換性を保たないため、再開後の「旧binaryへ戻すだけ」は通常の復旧手段にしない。
この制約を停止切替rehearsalと再開判断に含める。必要な保全・確認が成立しないときは、
メンテナンスを継続して修復し、利用者の新規データを捨てて復旧を急がない。

### 7.5 後片付けと完了報告

検証用の一時資材は第6節に従って回収する。一方、本番baseline・旧artifact・切替記録は
通常のtest cleanupから除外し、再開後の確認と復旧用の保持期間を満たすまで残す。
その期間・保管先・削除判断は実際の作業記録で確定する。移行に関係する画像objectを先に消さない。

**実装完了時の報告:** 受入条件、対応revision、必須gate、MCP E2E、実DB競合・復旧・migration保全、
停止切替rehearsal、代替境界・未検証事項、cleanup結果を整理する。
実装完了と本番導入完了を区別し、未実行の必須確認を通過扱いにしない。

## 8. 実行記録

実装は[MOM-24](https://linear.app/ponta/issue/MOM-24)とMOM-25〜28で管理する。
remoteへのpush・PR・merge・本番適用はこの実行記録の完了範囲に含めない。
ローカルnative gateはDockerfileの固定依存を使ったLinux/arm64で実施し、CI runner側のarchitectureでの実行は未実施である。
依存pinは検証したmomo-db / Summitのcommitを指し、公開前に依存commitを先に到達可能にする。

| 境界 | 実行した証拠 |
| --- | --- |
| momo-db | build、正規migration生成・履歴check、全履歴fresh適用、実DB制約9件、migration保全10件が通過。0056の復元コピー検証では全既存public tableの行と適用hashを比較した。追加した業務function/triggerはない。 |
| API | unit 492件、実DB 199件、Redis 6件、互換object storageのadapter 1件、quality・整形・OpenAPI生成とfreshnessが通過。 |
| Web | 全体159 file / 946 testが通過。その後の受付失敗時の編集可能性・404/409分類・cache修正は関連43 testで再確認した。型・lint・build・API契約も実施。 |
| Summit | unit 623件、実DB 90件、typecheck・lint・knip・build・文書/禁止API検査が通過。実DBのDate bind fixtureを初回失敗後に修正し、該当testの再実行を区別して記録した。既存のfile size advisoryは残る。 |
| Worker | workspace 271 testと追加fixture契約1件、fmt・strict clippy、実DB/RedisのOCR 5 suite・共通分析18 suiteが通過。通常workspaceでignoredの外部境界は各smokeから実行した。Linux/arm64 production image build、image smoke、release DB互換、native分析runtime、OCR preemptionが通過。非root・CA・cgroup制限・child cancellation/reapと所定の脆弱性scanも確認した。 |
| 切替・復元 | 旧未終端job/通知が残る間は開始条件不成立。0055のbaselineをdump/restoreして0056適用・既存行保全を検証。新業務書込み前の全体復元と、書込み後の単純復元不成立を確認した。queue識別と所有画像bytesの対応も保持した。 |
| 組合せE2E | 実API・画像storage・Redis・Linux Worker・実Summit repository/HTTP/renderer/dispatcherを通すCLI E1〜E4を確認。E1/E2の通過後、待機oracleを修正したE3/E4の2件を再実行して通過した。標準E2EはOCRを含む6件と、cleanup修正後の代表1件が通過。 |
| Playwright MCP | built Webを1280px/390pxで実確認。E1〜E4に期限終了dialogからの明示新送出も加えた9送出が、各1件のv2 receipt/投稿へ収束した。遅延barrier・再走査後の通知0件、失敗だけの文面、全失敗後の編集、応答喪失retryのjob POST非重複、旧member/本文の不変、job0期限終了、別IDでの再送を確認。設定OFF/ONの保存・再表示、keyboardでのretry、新送出、Escape時のfocus復帰、横overflowなしも確認した。 |
| 実native通知 | 同じ隔離環境でcontrolled consumerを正常停止してからproduction imageへ切替。実native childで合成PNGを処理し、attempt 1 / succeeded / OCR draft作成→送出settled→Summit v2 / renderer2 / partCount1 / DELIVERED→記録用送信先1通まで通過した。画像読取り精度の一般化は保証しない。 |
| harness回収 | 部分起動SIGINT、recorder起動失敗、終了したlauncherの残存子processを実行して回収を確認。CLIと標準runnerの出力先を分離し、cleanup失敗は成功扱いにしない。 |
| 旧API起動 | 旧revision `f9774d26`の追跡fileだけをstage build。0055までの56 migrationを正規適用して作った旧DBのdumpを別専用DBへ復元し、全public row/history一致と0056 table不在を確認。旧APIのhealth、既存下書き・terminal OCR v1 job読出し、旧形式の下書き→upload→job受付が通過した。 |

初回の総合E2Eでは、制御childの事件簿candidateが本番validatorに拒否された。
本番の検証を緩和せず、test側を保存layout hintsに合わせて修正して再検証した。
並行runnerのtrace出力衝突は出力先分離、終了後のprocess group判定は生存memberの照合で修正した。
job0期限終了の最初のoracleは安全走査周期と同じ長さでtimeoutしたため、test側の待機余裕を増やして再実行した。
これらの失敗attemptと再実行を区別し、最初から全suiteが通ったとは扱わない。

PR #52の初回remote CIでは、初回送出受付が入力のナノ秒精度、再送がDB保存後のマイクロ秒精度を返し、
期限の同値確認が失敗した。固定ナノ秒の回帰testでローカルでも再現し、INSERTのRETURNINGで
初回応答も保存時刻に揃えた。修正後はquality・OpenAPI freshnessと実DB 199件が通過した。
この追記時点で修正後のremote CIは未確認であり、本番適用は行っていない。

MCPで通した登録jobありの7送出について、最後のjob終了→送出確定と、確定→受付/配送を分けて採取し、
走査・受付の時間予算を満たすことを確認した。実測値は公開文書へ転記しない。
MCPのconsole errorは意図的に落としたjob/upload requestに対応しており、通常操作の例外として扱っていない。
実native通知まで確認済み。recorderのNode直接起動・HTTP readiness・正常停止も確認した。
補助起動probeの初回は回収済みDBを指して失敗したため、現存する所有DBへ接続先を修正して検証した。

主な実装commitはmomo-result `ea10297c` / `6f58c96f` / `b2b320c5` / `1c8e6930`、
E2E/CIは `025832ae` / `e77e174f` / `e6d84dea` / `40292345` / `8523cc5d`、
momo-dbは `87d18c6`、Summitは `baa1894`。3 repositoryとも`feat/mom-24-ocr-submissions`で保持した。

検証用DB・Redis・画像storage・所有container/volume、producer/consumerと子process、追加image tag、
試験用接続設定、合成画像、backup、計測/送信記録/log、browser tab/storage、試験出力を回収した。
一時worktreeも回収し、momo-db/Summitの元のcheckoutを今回のfeature branchへ切り替えた。
以前のbranch、元からの未追跡設定、共有cacheは保持している。所有manifestとの照合で対象資材の残存がないことを確認した。

復元rehearsalは専用の代表旧データを使用し、本番dumpを使っていない。
旧APIの読取り前後で既存row/history不変を確認し、旧APIによる新規受付ではnative OCRを動かしていない。
この結果を、全旧consumerの再起動や実provider・実Discordの復元確認とは扱わない。
専用session routeでLISTEN・再接続を検証した。production pooling routeの可用性をこの結果で代替せず、導入時のroute probeで確認する。
互換object storage、記録用Discord port、開発認証を使っており、実providerの認証・通信、実Discord到着、Discord OAuthは未検証。
本番の停止時間・担当・artifact保管・自動deployとの調整は第7節に沿って実際の導入時に確定する。
