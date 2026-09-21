# MOM-24 OCR送出単位通知 — 敵対的レビューと改訂仕様案

対象: [MOM-24](https://linear.app/ponta/issue/MOM-24)

状態: 利用者と確定した要求とレビュー判断。実装済みの保存・wireはmomo-db、APIは生成OpenAPIを正本とする。
導入前提は、利用者の指定によるメンテナンス中の一括切替へ改訂した。旧OCRとの稼働互換は維持しない。
具体的な実装・停止切替・rollback条件は[実装・検証計画](ocr-submission-notification-plan.md)を参照する。
本書の状態名・データ項目は論理モデルであり、DDL・API wireの確定稿ではない。
要求は `requirements/base.md`、業務状態は `domain-rule.md`、責務は
`architecture.md`、共有保存・wire契約は各専門正本へ反映している。検証進捗は実装計画を参照する。

## 1. 確定した要求

- 1回の読み取り操作による「送出」を通知単位とする。同じ下書きでも後の追加・再読み取りは別の送出。
- 全対象画像の結果が確定するまで待つ。途中通知も、遅い画像だけの追加通知も行わない。
- 全部失敗も含め、送出ごとに通知する。成功・要確認の一覧・件数・警告は本文へ載せない。
- 本文は処理終了の案内、失敗した画像種別と安全な簡潔な理由、現在の下書きへのリンク。
  失敗がなければ失敗欄を省略する。既知の作品・開催・試合の文脈と送出の完了日時を添える。
- 通知ON/OFFは送出全体の確定時に判定する。途中でOFFからONにしても確定時にONなら対象。
  OFFで確定した送出を後のONで補完しない。
- 同じ受付操作の通信再試行、画像ジョブの内部再試行、配送の再試行は新しい送出ではない。
- 下書きの確定・削除による不要通知の取消し、通知OFF後の未開始配送の取消しを維持する。
- 通知失敗がOCR結果の保存や下書きの利用を失敗に変えない。

「失敗」には最終的なOCR失敗・タイムアウト・個別ジョブの中止、および受付できずに終了した
画像を含める。下書き自体の確定・削除は通知全体の取消条件であり、失敗通知へ変換しない。
要確認は読み取れなかった画像として列挙しない。

## 2. 前案に対する指摘

| 重要度 | 反例・問題 | 改訂 |
| --- | --- | --- |
| 高 | 1枚目のOCR終了時には2・3枚目をまだ受付中。「現在存在するジョブが全部終わった」で通知すると早過ぎる。 | 対象の1〜3枠を最初の受付transactionで固定する。未受付枠も終了判定の対象。 |
| 高 | 最後の画像をAPI保守処理がタイムアウトにした場合、Workerの成功callbackは実行されない。全部アップロード失敗では画像Worker自体が起動しない。 | 全体確定を画像の成功callbackから独立させ、Workerの送出finalizerが保存状態から行う。 |
| 高 | 最終画像の終了、送出全体の確定、HTTP送信の時刻を混同すると、途中の設定変更を誤判定する。 | 全体確定のtransactionを一意に定義し、その中で設定と世代を確保する。送信時の設定から本文を作り直さない。 |
| 高 | 完了済み送出を「通知が見当たらないから」と回収すると、実質的なproducer outboxになる。 | 回復対象を未確定送出に限定する。全体確定後の未送信回収・HTTP再試行は追加しない。 |
| 高 | 受付期限で終了した枠へ遅れたrequestがジョブを追加すると、送信済み本文が嘘になる。 | ジョブ作成・枠への紐付け・期限終了を排他する。閉じた枠を再開しない。 |
| 高 | 新旧Workerが同じ画像に対して旧画像通知と新送出通知を作る。 | 旧処理を排出して全writerを止め、一括切替する。新Workerの画像単位通知は削除する。 |
| 高 | 共有schemaの所有者に合わせ、終了判定・設定判定・payload生成までmomo-dbへ移してしまう。 | momo-dbは構造・型・整合性制約を所有。業務判断・transactionの組立て・SQL queryはconsumerが所有する。 |
| 中 | 現在の下書きslotから集計すると、後の画像差替えによって別送出の結果が混ざる。 | 不変の送出member→job対応から判定する。下書きslotの現在値を集合の正本にしない。 |
| 中 | HTTPのidempotency記録だけでは、業務commit後の応答喪失や記録整理後の再送を扱い切れない。 | 送出IDとmemberの一意性を業務保存で守り、送出IDによる状態取得を用意する。 |
| 中 | 通知schemaのversionを変えても、受付DBのversion列が既定値のまま残る。 | envelope・保存列・validator・rendererを対応させる。分析v1を維持し、既存OCR v1は履歴だけを保つ。 |
| 中 | 集約通知が長い文脈やエラー全文で分割され、利用者には複数投稿として届く。 | 失敗理由を固定の安全な分類へ制限し、最大3件と表示用文脈の上限から1投稿を検証する。 |

レビューの対象となった実装入口（リンク先は変更後の実装）:

- [画像を順番に登録するWeb workflow](../apps/web/src/features/ocrCapture/ocrSubmissionWorkflow.ts)
- [OCR送出確定時の通知準備](../apps/processing-worker/src/notifications/ocr.rs)
- [Workerの成功・失敗・内部再試行](../apps/processing-worker/src/ocr/control.rs)
- [API保守によるOCR最終失敗](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresOcrJobMaintenanceRepository.scala)
- [下書きslot状態の投影](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresMatchDraftStatusSync.scala)
- [HTTP idempotencyの保持・応答不明境界](../apps/api/src/main/scala/momo/api/http/IdempotencyReplay.scala)
- [現行通知sender](../apps/processing-worker/src/notifications.rs)
- [Summitの固定payload受付](../../summit/src/db/repositories/resultNotifications.receipt.ts)
- [通知の共有schema](../../momo-db/src/schema.ts)、[共有型](../../momo-db/src/notifications.ts)

## 3. 責務とmomo-dbの境界

| 所有者 | 所有する判断・処理 |
| --- | --- |
| Web | 操作開始時の画像・設定snapshot、同じ操作IDの再利用、結果不明時の状態取得、明示した再読み取りの新規操作化 |
| momo-result API | 認可、送出とmemberの受付、画像とjobの原子的な紐付け、受付の確定失敗、下書き確定・削除に伴う取消し、既存の画像job保守 |
| momo-result Worker | 保存状態からの送出全体の確定、未受付memberの期限終了、通知可否・世代の確保、固定payload準備、commit後の一度だけの送信 |
| Summit | payload形式検証、永続受付、設定世代・対象状態による配送取消し、描画、配送claim・再送・保持 |
| momo-db | table・column・index・PK/UNIQUE/FK/CHECK、migration、共有wireの構造型・構造検証・ID形式、consumer間の保存契約 |

momo-dbに追加しないもの:

- 全画像の終了を決めるstored function・trigger・viewを業務commandの代わりにする仕組み。
- 通知設定の解釈、送出の状態遷移、受付期限の選定、再実行可否、通知本文の生成。
- `@momo/db`から呼ぶ共通の通知業務service、scheduler、通知outboxの自動生成。
- 同じ終了判定をAPI・Worker・Summitへ分散させるための共通policy実装。

DB内で計算するSELECTやguard付きUPDATE自体は問題ではない。アプリのrepositoryが所有し、
アプリcommandの明示したtransaction内で実行する。rowの形状や一意性を守る宣言的制約と、
「いつ送るか」を決めるpolicyを区別する。既存の[DB規約](db-rule.md)および
[共有通知契約](../../momo-db/docs/discord-notifications.md)と一致する。

## 4. 必要最小限の保存モデル

送出headerと最大3件のmemberを基本とする。汎用workflow engineや画像とは別の計算jobを作らない。

| 記録 | 必要な情報 | 重複保存しない情報 |
| --- | --- | --- |
| 送出header | 不変ID、作成主体、対象下書き、受付内容の照合情報、受付時刻・受付期限、open/settled/aborted、終了時刻 | Discord配送状態、再送回数、送信待ちpayload |
| member | 送出ID、指定画面種別、不変の受付識別、受付待ち／受付失敗／job登録済み、登録したimage/jobへの対応、受付失敗の安全な分類 | OCR成功・失敗・警告の別コピー、完了件数counter |
| 既存ocr_jobs | 画像処理の状態・終了結果 | 送出全体の通知可否 |
| 既存Summit通知table | 受付後の固定payload・世代・配送状態・重複抑止 | OCR実行の進捗 |

- member集合は送出受付transactionで作成して固定する。種類の重複と空の送出を受け付けない。
- job登録済みmemberのimage/job対応は後から差し替えない。新しい画像は新しい送出。
- OCR結果の正本は既存job。通知生成に成功画像のOCR本文や警告payloadを読み出す必要はない。
- `(submission, screen_type)`とjobへの対応に必要な一意性を置く。全memberの終了という
  複数rowにまたがる意味論はアプリcommandで保証する。
- 未確定送出から参照するjob・受付記録と、期限内uploadを既存cleanupで消さない。
  今回は薄いheader/memberを保持し、同じIDの再受付で業務を再作成させない。
  詳細の圧縮・archive schedulerは別変更とし、別の汎用dedupe tableも増やさない。
- 下書きの物理削除後も必要な取消・重複抑止の識別を失わない。cascadeで通知履歴を消さない。
  下書きの不変IDを保持し、物理削除と両立する参照制約を選ぶ。

## 5. 受付・期限・再試行

1. 認可済みの下書きを対象に、送出IDと全memberを一つのtransactionで受け付ける。
   同じID・同じ内容は既存状態を返し、異なる主体・内容での再利用は拒否する。
   送出受付にもrate limitと主体別open上限を適用し、同時受付でも上限を超えない。
   同じ操作の照会・再送では新たな業務枠を消費しない。切替後のjob受付は送出所属を必須とする。
2. 各画像のjob作成とmemberへの紐付けを同じtransactionへ含める。
   同じ枠を二つのjobへ結び付けない。登録済みrequestの再送は既存jobへ収束する。
3. 通信切断やHTTP timeoutは失敗確定の根拠にしない。クライアント申告だけで
   「未受付」「全部失敗」に変えず、保存済みの対応を再取得する。
4. 受付待ちmemberには受付時点で固定した有限の期限を持たせる。再送で無期限に延長しない。
   確定的な受付拒否は早く終了できるが、結果不明のrequestは照合または期限を待つ。
   一時的な混雑・rate limit・再試行可能なupload失敗をmemberの最終失敗へ変えない。
5. 期限処理はjob登録と同じ送出の排他境界で、まだ未受付のmemberだけを閉じる。
   登録済みjobを受付期限によって打ち切らない。OCR自身の最終失敗・timeoutは既存契約を使う。
6. 期限終了したmemberへの新規job登録を拒否する。期限直前にcommit済みの同一requestは
   既存jobを返せる。終了した送出のmemberを再開しない。
7. 利用者が改めて失敗画像を読み取る場合は新しい送出にする。既存の通信再試行を
   クライアントが黙って新しい送出へ置き換えない。

送出受付前の通信失敗はサーバーが通知対象を知り得ない。受付済みの送出については、
ブラウザ終了、全画像未受付、途中離脱でもmemberの期限終了によって収束できる。
受付期限の具体値は実装前に通常の画像転送・再試行時間を根拠として選定し、
既存OCRの処理期限とは分ける。通知集約のためにOCRの処理期限を短縮しない。

## 6. 全体確定を行うWorkerのcommand

全体確定の唯一の担当をWorker内の小さな送出coordinatorとする。APIとWorkerの各画像writerは
既存job状態を保存する。APIへDiscord送信clientや終了payloadの生成を追加しない。
下書きに伴う取消しはAPIが行えるが、これは通知を作る通常の全体確定と分ける。

coordinatorは以下を一つの意味的なcommandとして公開する。

`settleSubmission(id) -> StillOpen | AlreadyClosed | Settled(postCommitEffect) | Aborted`

- 対象下書き・送出を既存のsource lock順と整合する順で排他する。
  member登録・受付期限終了・全体確定が競合する共通の送出lockを定める。
- lock取得後の新しい読み取りで固定memberとそのjobを確認する。
  `queued`、`running`、内部再試行中、未受付のmemberがあれば終了しない。
  参照不整合を成功や空集合として扱わない。
- 全memberが最終状態ならopenからsettledへ一度だけ進め、終了時刻を保存する。
  下書きが既に確定・削除済みなら通知を作らず閉じる。
- 業務更新後、同じtransactionの回復可能な通知準備境界で共有通知gateを取り、
  次のstatementでOCR通知設定・世代と表示用文脈を読む。
  gate取得後に新しい業務row lockや業務writeを追加しない。
- ONなら失敗memberのみの固定payloadをメモリに準備し、OFFなら送信effectを作らない。
  準備のtimeout・容量不足・回復可能な失敗では全体の確定を続け、通知を省略する。
- commit成功を確認した実行だけが、既存の上限付きsenderへeffectを渡す。
  DB transaction、画像計算slot、画像jobのACKをHTTP完了まで保持しない。

**「全体確定」はこのcommandが送出を終端としてcommitすることを指す。**
最後の画像の終了は確定条件であり、同一の瞬間とは限らない。Worker停止中にAPIが最後の画像を
失敗にしても、送出全体は未確定であり、復旧後に確定するときの設定を使う。
画面で送出全体の完了を示す場合もこの状態を使い、画像job終了から先取りしない。
既存の下書き編集・確定可否は別の業務状態であり、通知の都合で不必要に待たせない。

設定競合は共有gateで順序付ける。全体確定と同じtransactionで読んだ世代を用い、
送信時に最新設定へ置き換えない。設定取得に失敗しても後からONとみなして補完しない。
commit結果が不明な実行からはHTTP送信しない。

## 7. wake・復旧・配送保証

- 送出の受付、memberの受付結果、画像jobの終端変更は、commit後のwake hintの契機にする。
  最後のwriterがAPIかWorkerか、結果が成功か失敗かでwakeの有無を変えない。
- wakeは未確定送出の再確認を促す合図であり、通知本文も配送命令も持たない。
  既存のcommit後の通知方式とWorkerのlifecycleを利用できる範囲で再利用する。
  業務保存とwakeは原子的とは限らず、合図の失敗で業務保存を覆さない。
- 起動時・接続復旧時・合図喪失後の回収はopenの送出だけを上限付きで扱う。
  LISTENを初回scanより先に確立し、受付期限に合わせた起床と公平な巡回を持つ。
  idle時の初回hint喪失も発見する低頻度の安全走査を残し、短周期の全件走査は増やさない。
  長時間未終了・不整合・lock待ちの1件で後続を止めない。
- 全画像の受付が失敗して画像計算が一度も動かなくてもcoordinatorへ到達することを確認する。
- この永続stateは未終了の業務処理を回復するためのもの。settledの送出に通知が存在しないことを
  検出して送る処理は実装しない。`pending_notification`や送信成功flagを送出へ追加しない。

| 停止・失敗地点 | 期待する動作 |
| --- | --- |
| 全体確定前 | openから再判定する。結果は保存済みstateから確認する。 |
| 全体確定transactionがrollback | 確定effectを送らず、未確定なら後で再判定できる。 |
| 全体確定commit後・HTTP前 | 送出は確定済み。通知欠落を許容し、再構築しない。 |
| HTTP失敗・受付不明 | Workerは再送しない。既存の相関情報で確認する。 |
| Summitが永続受付した後 | Summitが同じ固定通知の配送・再送を行う。 |

これは現行の受付前欠落／受付後再送の責任境界を維持する案である。
「送出1回につき1通知」は通常時の論理通知とDiscord投稿の単位を指し、
障害時の到着保証や外部送達の厳密なexactly-onceを新たに約束しない。
全serviceの停止中まで有限時間内の終了を保証するものでもない。

通常時は全体確定後に集約用の追加待ちを置かない。前案の「確定後1分以内」という到着目標だけでは
coordinatorの遅延を隠せるため、最終memberが終了してから全体確定するまでの時間も別途測る。
具体的な受付期限、再確認間隔、到着目標の達成は未実測であり、実装時の受入対象とする。

## 8. 通知データ・取消し・停止切替

- 新OCR payloadには送出ID、下書きID、全体確定日時、設定世代、既知の文脈、
  失敗memberの指定画面種別と安全な失敗分類だけを持たせる。
  成功・要確認の区別は新通知wireへ不要。失敗配列が空でも有効な通知である。
- 失敗の表示順を総資産・物件収益・事件簿に固定する。
  通知には例外全文・OCR値・元画像・内部識別の詳細を表示しない。メンション抑止を維持する。
- 通知IDは画像jobや最後に終了したjobから作らず、送出IDに一意に対応させる。
  既存の元処理ID欄を使う場合は画像jobと衝突しない送出用namespaceを定義する。
  attempt・設定世代・HTTP request・wire versionを通知IDの発行理由にしない。
- 取消対象は既存と同じ下書きID。後の同一下書きへの別送出で過去通知を書き換えない。
  確認先は現在の下書きなので、過去送出の画像が差し替わっている場合がある。
  通知の完了日時・固定本文と、リンク先の現在状態を混同しない。
- 通知ON/OFFは全体確定時の対象判定と、配送前の取消判定の両方に効く。
  確定時ONでも、その後OFFなら未開始配送を取り消す。OFF→ONで世代を跨いだ通知は復活しない。
  送信開始済みは到着し得る現行境界を維持する。
- 新OCRはv2として扱い、旧OCR v1の新規受付・配送・手動再送は切替後に提供しない。
  今回変更しない分析v1は現行契約として維持し、共通定数の変更で分析producerまでv2にしない。
  Summitは受信versionをDB列へ明示保存し、schemaVersionとrendererVersionを区別する。
  保存済み旧OCRのpayload・hash・identity・履歴は保持し、旧rendererの継続稼働をその条件にしない。
  inspectのretryable、retry command、claim/次回dispatch検索で未対応旧OCRを再送対象から外す。
- 最大3件の失敗、固定理由、表示用文脈の長さを制限して新OCR通知を1投稿に収める。
  長い任意の表示名は省略を明示して短縮できるが、失敗member・理由・確認先は落とさない。
  エスケープ後・実際のURL込みの長さで検証する。

既存通知tableは正のschema versionと文字列の元処理IDを保存でき、対象下書きによる取消しもある。
現時点の調査では、集約通知専用の配送table、新しい通知種別、通知DB関数を追加する理由はない。
追加DDLは送出の保存と既存jobへの関連を中心に設計する。

メンテナンスで新規受付を止め、旧OCR処理と未終端の旧OCR通知を旧一式で排出する。
排出できなければ切替を中止し、黙ってjob/通知を破棄しない。過去jobを新送出へ推測backfillしない。
全writer・外部配送を止め、復元確認済みbaselineを取得したうえでschemaと全consumerを一括切替する。
旧Web/API/Workerとの混在経路や画像単位通知のfallbackは作らない。

新しい正規業務書込み・外部送信より前は、DB・queue/objectの対応と旧artifact一式をbaselineへ戻せる。
開始後は新データを保持するforward fixを基本とし、古いbackupの上書きや旧binaryだけのrollbackをしない。
Discord送信はDB復元では取り消せない。切替開始・再開・復元の具体条件は実装計画の第7節に従う。

## 9. 実装時の受入証拠

| 境界 | 主な反例・oracle |
| --- | --- |
| 受付API / 実DB | 1枚目完了時に残り未受付、同じIDの同内容／異内容、job作成commit後の応答欠落、期限処理と登録の競合、open上限、一時失敗後のretry |
| Worker / 実DB | 成功のみ、要確認のみ、一部失敗、全部失敗、最後がAPI timeout、全件未受付、内部再試行中、同時finalizer、rollback・commit不明 |
| 取消し / 実DB | 全体確定と設定変更の競合、確定前OFF→ON、確定後OFF→ON、下書き確定・削除・マスター経由cleanupとの競合 |
| 復旧 / runtime | idle時の初回wake喪失、起動時回収、公平な巡回、画像計算0件、未確定だけ回復、確定後HTTP前停止で再送しない、slot非占有、短周期走査抑止 |
| wire / Summit | 空の失敗配列、3件失敗、旧OCR拒否・分析v1維持、DB保存version、同一ID異内容拒否、1投稿の最大長、固定本文・取消・再送 |
| Web / Playwright | 受付結果不明の照会と同一操作再試行、期限終了後の明示的新送出、送出の状態表示、全失敗後の下書き利用 |
| migration / 保持 | 既存通知・設定・履歴を保持、未確定member参照の保護、終端識別の重複抑止、停止切替とbaseline復元、再開後の単純復元拒否 |

DBは形状・一意性・参照制約を検証し、業務遷移は実際のconsumer commandで検証する。
DB testだけを全体確定・配送の保証にしない。各変更のgateは `test-rule.md` と `dev-rule.md` に従う。
momo-dbの編集・migration操作を始める前に、同repositoryの `docs/development.md` を全文確認する。

## 10. レビューの評価と残る設計作業

利用したsoftware-design-philosophyの8診断による前案の文書上の暫定評価は4/8、5/10。
未達は「担当を一文で説明できる」「実装変更を境界内へ閉じる」「操作の約束を明記する」
「新規参加者が責務境界を理解できる」の4点。単一finalizer、薄い共有DB、明示した確定・再試行・
通知契約によって、それぞれの改善を本案に記載した。実装を採点したものではない。
その後の計画レビューでは、利用者指定により旧版併存を停止切替へ置き換え、
wake喪失・公平性・受付上限・試験基盤の実現性を補強した。現時点の評価は実装計画の第0節を参照する。

実装着手前に、受付期限の値、coordinatorのwake接続・再確認の時間予算、全writerを含むlock順、
具体的なDDLとAPI wireを確定する必要がある。利用者向けの集約単位・通知本文・ON/OFF方針は変更しない。
この技術設計で本書の単一ownerや通知非再送の境界を満たせなければ、矛盾を残して実装せず再検討する。

今回の確認は現行コード・schema・規約の読取りと反例による設計点検。
新仕様の動作、競合、性能、配送時間は未検証である。
