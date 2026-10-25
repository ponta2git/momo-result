# Processing Worker 規約

目的: `apps/processing-worker` の parent / child 境界、runtime と listener と停止、資源予約と scheduling、分析の公開と release 制御、OCR capability の役割、通知の準備と送信の実装契約を定める。現在の設定名・既定値・timeout は runtime 設定、payload の shape / limit は schema を正本とし、本書ではその正本を参照する。

API と Worker の非同期 job 契約は [OCR job 契約](ocr-job-contract.md)、job / artifact / version の要求は [分析 batch 要求](requirements/series-analysis-batch.md)、DB の lock 順・staging・gate は [DB 規約](db-rule.md#consumer-contract)、ログと診断の制約は [アーキテクチャの Runtime / Security](architecture.md#runtime--security) を参照する。品質証拠は [テスト・品質規約](test-rule.md#processing-worker-evidence-catalog) から選ぶ。

## Process Boundary

| 関心事 | parent process | attempt child process |
| --- | --- | --- |
| 外部 I/O | DB、object storage、通知を所有 | 分析の read-only snapshot に限って許可する |
| lifecycle | claim、lease / fence、spawn、制限、timeout、停止、reap | 1 attempt だけを実行する |
| 出力 | candidate を検証し、transaction で初めて確定する | bounded で非 authoritative な candidate を返す |
| 完了 | durable commit、post-commit effect、slot 解放 | job 終端、公開、要求の変更は parent に任せる |

- Analysis / OCR は同じ parent lifecycle を共有し、種類固有の入力、claim、状態遷移、計算を分ける。
- capability crate は決定論的な domain / 計算 / version 付き論理契約を所有し、DB、filesystem、clock、async runtime から独立させる。runtime から capability への一方向依存とする。
- 通知基盤の `momo-notifications` は件数・bytes の予約、envelope の serialize、呼出側 transaction による最終 JSONB サイズ検証、transport 設定の検証と HTTP 送信を所有する。通知内容を作る producer、業務 SQL、DB 接続、SAVEPOINT と commit、環境変数の読取り、sender の監督・停止期限は worker が所有する。worker から通知基盤への一方向依存とする。
- TERM・KILL・process group の回収は共通化し、分析の入力設定・終了分類と OCR の frame・結果 decode は各 capability の process adapter に残す。`unsafe` の例外は OS FFI を checked な safe API の内側へ閉じるためにだけ使い、許す module と理由は workspace lint とその例外指定を正本とする。
- child の計算完了と durable な公開を分け、二つの所有を区別する。job の durable 更新・公開の権限と stale owner の拒否は、process 内 semaphore や台数ではなく、DB の lease と fencing token で世代をまたいで守る。lease の失効が担うのは旧 owner の write の拒否である。子 process の物理的な停止は parent の実行管理と process adapter が担い、次の計算枠は parent の資源予算が所有する（[Resource Reservation and Scheduling](#resource-reservation-and-scheduling)）。

## Runtime / Listener / Shutdown

- `worker` の単一 runtime が構成、共通 preflight、module の bootstrap、job 選択、所有 task の監視と停止を管理する。supervisor と scheduler の制御も共通の run loop にまとめる。停止・業務側の回復不能な異常を検知した時点で新規 claim と調停 step の開始を止め、一つの絶対期限で終了する。通常の確定処理の予算に強制停止・回収確認の猶予を加え、同じ期限内に予約する。DB 処理中も停止・task 異常を監視し、進行中の transaction は通常の wake があっても継続する。
- 停止 signal・回収 handle・最初の異常原因は、起動・通常運転の Future が捕捉可能な panic で失われても保持する。panic の捕捉は終了処理へ移るためだけに使う（失われた業務状態を再利用して通常運転へ戻らない）。業務異常は後始末が成功しても異常として扱い、最初の原因と停止期限は二次的な失敗があっても保つ。commit 成否不明の仕事は推測で確定せず、DB の lease・fence と次回起動時の復旧に委ねる。
- 共通 listener task は job と有効な OCR 受付の payload-free route を同じ接続で購読し、各 route の初回 round trip を確認してから発見処理へ進む。初回の購読・疎通確認の失敗は起動失敗とし、両 route は一つの再確認 signal へまとめる。稼働後の一時切断は停止可能な局所再接続と疎通確認後の補完走査で回復し、protocol 違反・panic・内部経路の予期しない破損は worker 全体の停止へ進める。再接続中も listener は一世代だけとし、通常停止による channel 終了は正常終了として扱う。業務や scheduler の知識は汎用 PostgreSQL 接続層の外に置く。
- PostgreSQL の session state へ依存する listener は、通常 query 用の transaction-pooled 接続と設定を分離した session-capable 接続を所有する。機能成立は `LISTEN` 文の成功ではなく、startup readiness 前に確認した別接続からの通知 round trip で判断する。
- Worker runtime は起動・再接続時の走査、bounded drain、実行可能時刻、lease 回復、backoff を扱い、低頻度走査で通知欠落を補う。候補選択と実行権取得を分け、claim / fence で複数親の競合と古い owner の更新を制御する。
- 親の非同期実行は current-thread runtime を使い、bootstrap と資源を保持する module state は親の runtime 内で保持する（独立 task にしない）。
- 計算 attempt は種類ごとの型付き Runner で実行し、停止・終了・子と補助 task の回収は共通の実行管理 handle で監視する。通常の Err でも Runner 資源を返して task の panic と区別し、完了待ちが中断されても回収の所有権を保つ。実行の正常終了と成果物公開の成功は別々に判定する。業務固有の claim や成果物は共通 handle の外に置き、次の attempt へ渡すのは回収を確認した資源と実行枠だけとする。
- module の bootstrap は接続・capability・入力前提を整え、未完了仕事も通常運転の有限な発見・実行経路へ渡す。起動条件は全件列挙や全受付の終端から独立させる。取得済みの資源は bootstrap 全体の成功前から回収可能にし、登録済み capability は後続の起動失敗時にも draining へ移す。分析の module state は work 準備・保守・draining と再利用資源を所有し、Runner は claim 済み attempt に絞る。実行中も後続 work の準備を進め、attempt 間に履歴と一時領域を整理する。起動時に残った一時領域の再確認期限も通常運転へ引き継ぐ。
- 親の重い blocking 処理は一つの実行枠を実処理の完了まで保持する。呼出 Future が timeout した場合も同じとし、処理が残る場合は worker を停止する。Tokio runtime の終了は、blocking task の待機を含めて同じ停止期限の残り時間に収める。

## Resource Reservation and Scheduling

- instance の CPU・memory 予算は一つの attempt 全体に予約し、同時実行数は 1 に固定する。予約は claim 前に取得し、claim が成立しなかったと確認できた場合、または子 process と補助 task の回収確認後にだけ返す。lease は durable write の許可であり local compute の排他ではないため、次の計算の許可は lease 失効、timeout、Future の破棄ではなく回収確認に基づく。将来の子 task も同じ予算を使い、task を分割しても同時実行数は 1 に保つ。
- 子 process tree の CPU bandwidth と hard memory limit は実 runtime の cgroup で保証する。CPU 予算は専用の設定値で指定し、runtime の CPU 割当を超える構成は拒否する。memory は child limit と親用 headroom の合計を runtime budget 内に収める。開始 barrier を開く前に両 controller への所属と制限値を読み戻し、v1 の別 hierarchy も両方が空になるまで回収を続ける。非対応 OS や未検証の制限は job claim 前に fail closed にする。
- 候補走査の soft な時間予算は一回の処理量を区切る目安とし、候補取得だけで予算を使い切っても候補があれば少なくとも一件を試みる。続きは cursor と次回期限へ引き継ぐ。停止要求、SQL の上限、lease・fence などの実行権の条件は、この予算にかかわらず守る。
- Busy 後の早期再確認は consumer ごとの共有予算で回数・開始期限・同時数を制限し、予算は新しい配送や再接続の後も引き継ぐ。上限到達時は元の回復・保守期限へ戻す。開始済み claim の確定と post-commit effect を処理してから次の候補へ進み、実行権は wake ではなく claim で得る。
- 待機候補では OCR を先に選び、試合の記録作業の待ちを抑える。実行中の分析は完了させるため、OCR が分析の終了を待つ場合はあり、この優先順は待ち時間の上限を保証しない。共有実行枠、旧世代の中断 intent の回収、再 queue、失敗回数、公開の詳細は [分析 batch 要求](requirements/series-analysis-batch.md#3-job--delivery) を正本とする。

## Analysis Publication and Release Control

- 分析 worker 内の Rust validator を payload 意味、canonical encoding、resource 集合・相互参照の単一 owner とする。parent は完全検証を通った opaque artifact だけを version 付きで公開する。API はこの意味検証を Worker に任せ、immutable publication attestation、生成 schema、reader resource 上限に加え、request identity・metadata・pointer の整合を独立に検証する。
- 分析成果物の公開とレーダー基準準備を実行目的で区別する。基準準備も同じ queue・共有実行枠・親子 process 境界を使い、保存元と全 scope の比較を検証する。準備の成功は、通常の分析要求の充足や公開完了とは別に扱う。
- 分析 release controller は active な algorithm / artifact schema / validation contract singleton と全 title への promotion を所有する。API / worker の capability registry を検査中だけ凍結し、互換判定から desired-state 切替まで、照合対象の registry の世代を保つ。lock 順は [DB 規約](db-rule.md#consumer-contract) に従う。
- 入力 version、algorithm version、artifact schema version、固定採点基準を別の識別として扱い、同じ入力・algorithm・基準の内容では決定論的にする。基準の適用日時と公開競合の世代は、計算内容の checksum から分離する。
- 計算順序や乱数列に意味がある最適化は、出力の canonical bytes まで比較する。結果の意味を変える場合は algorithm version の変更として扱う。
- 公開前の DB 照合は transaction 内で行う。順序の違いを許容する照合でも欠落・余剰・重複・値の不一致を拒否する。
- 分析の terminal 履歴と未参照 artifact の保持・整理は Worker の control 処理が所有し、API の起動とは独立に行う。保持条件は [分析 batch 要求](requirements/series-analysis-batch.md#5-artifact-contract) を正本とし、公開済み current / previous の保護と bounded cleanup を同じ DB 境界で保証する。

## OCR Capability

- OCR の object / 入力 / 状態契約は [OCR job 契約](ocr-job-contract.md) と schema を正本とし、URL、credential、local path を runtime 間 payload にしない。
- 認識 fallback は既存の評価順を保ち、必要になった画像だけ生成する。
- OCR の不確かな読取値は、必要な警告を保持して要確認結果として保存する。件数の妥当性しきい値は警告条件として使い（保存拒否の上限ではない）、parser と保存前検証で警告条件を一致させる。構造・型・対応関係が壊れた候補や警告の欠落は拒否する。
- API は送出の受付で、所有者・固定画像集合（member 集合）・受付期限を原子的に保存する。その後の各画像の job 登録は、対応する member の registered 化と一つの transaction にする。送出受付と job 登録は別の transaction であり、pending member のまま upload・job 登録が続く経路や、画像 job 0 件のまま受付期限を迎える経路も成立させる（[ドメイン規約の OCR送出](domain-rule.md#ocr送出)）。同一操作の PUT と登録済み member の再送は同じ識別子へ収束する。Web は全画像の内容識別と upload key を送出受付前に固定する。保存形は [DB 規約](db-rule.md#durable-state-rules) に従う。
- OCR の受付調停は現在の下書き slot ではなく固定 member と対応 job の終端を読み、全員終了後だけ送出を確定する。下書き → 送出の順に lock し、業務更新後の最後に result gate と設定を読む。ON なら文脈と失敗だけを固定し、OFF でも送出は終端にし、通知を省略した確定状態を保つ。確定後に通知を再構築しない。画像 0 件の期限終了も回収し、後の送出・slot 状態はそのまま保つ。
- 受付調停は共通 listener 確立後の初回・再接続・期限・低頻度の安全走査で open を巡回する。worker が最大一つの有限 step を駆動し、cursor・上限付きの発見済み ID・Busy 再確認予算を wake と接続交換の間も保持する。soft な走査予算を使い切っても先頭の一件は試み、途中の進捗を次の step へ渡す。Busy だった送出だけを早期再確認し、通常の安全走査・受付期限を後ろへ延ばさない。
- 受付調停と画像 Runner は可変資源を別々に所有し、OCR 画像・分析の実行資源予約と独立して調停を進める。task・接続は受付数から独立した構成とし、発見済み ID を上限付きで保持する。全受付の待機一覧は持たない。画像 Runner の生成と呼出しは OCR orchestrator に閉じ、各画像は Worker が process の資源を予約して job lease を claim した後だけ実行する。未到着 member の受付期限と登録済み画像 job の実行期限は別々に扱う。
- commit 後の wake hint は損失可能で、正本は保存状態。各送出を有限の transaction で扱い、settled commit を確認した経路だけが通知を dispatch する。共有 wire・宣言的な保存構造と排他契約は対象 `momo-db` checkout の `docs/discord-notifications.md` を正本とし、DB へ終了 policy や trigger を置かない。
- OCR の実行枠は通知の HTTP 完了と独立に解放する。

## Notifications

何を・いつ通知するかは [基本要求の Discord通知設定](requirements/base.md#34-discord通知設定) と [分析 batch 要求の分析完了通知](requirements/series-analysis-batch.md#分析完了通知)、transaction・lock・gate・SAVEPOINT の順序は [DB 規約](db-rule.md#consumer-contract) を正本とする。本節は Worker 側の envelope、producer の入力、時間予算、sender の挙動を定める。

- OCR・分析通知の envelope は `momo-notifications` が種類と source identity から通知 ID と wire version を構築する。OCR は送出単位の v2、分析は論理 job 単位の v1。各 producer は固定 data と確定時刻・世代を渡し、commit 後の handoff は制御側が所有する。
- 新規 producer 送出は [通知サイズと送出可否](requirements/base.md#通知サイズと送出可否) に従い、最終 envelope の HTTP 本文・JSONB text 表現と掲載内容を制限する。新規送出上限は、共有 wire の保存互換や分析の比較履歴読取とは別に扱う。上限超過は通知全体の省略とし、業務成功と分析の入力基準更新を維持する。描画後の投稿数検証は Summit が所有する。
- 分析完了通知は実行 attempt に結び付いた試合変更要求と前後の immutable 入力を照合し、公開 transaction 末尾で要求の完了を再確認して表示 metadata を固定する。入力が変わらない成果物の再利用は公開制御側で通知準備を省略する。通知準備は OCR と同じ回復可能な SAVEPOINT 境界を使い、正常 commit を確認した経路だけが共通 sender へ渡す。分析 child・API・Summit に平均計算や producer 送出の責務を移さない。
- 通知 producer へ渡すのは通知に必要な job・attempt・作品・成果物 version の識別情報だけとし、producer は DB の claim 型、lease、fence や全体設定から独立させる。
- 通知の入力基準は画面用 current / previous から分離する。公開制御は通知の可否とは独立して、公開・再利用成功と基準の更新を一つの transaction にする。初回と不明を区別し、読取不能な旧形式でも入力 metadata の完全性を確かめた範囲で差分を扱う。旧平均を現行形式として解釈せず、基準不足を全試合の追加に置き換えない。
- 比較用の成果物取得は同じ snapshot 内で前後の全試合 identity と scope metadata を照合し、差分判定後に作品通算と影響シーズンの保存済み player metrics だけを取得する。公開 validator が保証する immutable 成果物の意味検証に依存し、元成果物の byte・件数上限、全 identity・scope 整合性、取得した順位の typed decode は維持する。比較準備の時間枠には接続確立と全 DB 往復を含め、確定 transaction 内の準備とともに親の絶対期限から業務 commit・復旧の余裕を残す。比較 read transaction が正常 commit した新規接続は続く公開 transaction に再利用し、失敗・timeout 時は破棄する。
- 通知準備は確定処理と同じ絶対期限から残り時間を計算し、実行中 SQL の終了・SAVEPOINT 復旧・業務 commit の時間を確保する。通知用 SQL は余裕がある場合に限って実行し、復旧可能な準備失敗では業務成功を保って通知を省略する。commit 成功後だけ、件数・bytes・同時接続数に上限を持つ共通 sender へ渡す。
- 共有 gate 取得と snapshot 取得は別 statement のまま維持する（[DB 規約の Notifications](db-rule.md#notifications)）。比較・準備の timeout、残時間不足、DB エラーは区別し、準備失敗には処理段階・時間予算・経過時間・SQLSTATE を記録する。
- sender は DNS・接続・応答を含む単一の request 期限内で一度だけ HTTP を試み、整合する受付応答を永続受付の証拠として扱う。予約から dispatch、送信 queue 待ち、HTTP 処理の時間を既存の attempt・receipt 記録で区別する。DNS・接続・応答と TCP の一時的な停滞からの回復は、この単一の request 期限内で扱う。接続だけを先に打ち切る短い期限は重ねず、停止時は共通の停止・drain 期限に従う。応答不明時も試行は一度で終え、通知 outbox・再試行・再起動時の再構築は持たない。
- 停止時は producer の確定と最後の dispatch まで通知受付を保ち、producer の sink・予約を解放してから、残りの共通期限で通知を drain して task 終了を確認する。通知待ちだけの期限切れでは、正常な業務停止を成功のまま扱う。sender は独立した task として監視し、捕捉可能な panic・予期しない終了では通知受付を閉じて業務を継続する。通知 task は自動再起動せず、終了確認は所有者の破棄ではなく task の終了で行う。この異常隔離は稼働中の sender が対象で、通知設定不正や HTTP client 初期化失敗は起動失敗として扱う。
