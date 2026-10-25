# OCR Job Contract

目的: API が保存する OCR 入力、Worker の直接取得、実行・再試行・回復の意味を定義する。入力の shape / limit は JSON Schema、DB shape は対象 `momo-db` checkout（[DB 規約](db-rule.md#ownership)）、時間と回数の現在値は runtime 設定を正本とする。

関連正本:

- 入力: `docs/schemas/ocr-job-input-v2.schema.json`
- hints: `docs/schemas/ocr-hints-v1.schema.json`
- 状態遷移と送出: [ドメイン規約](domain-rule.md#ocr-job)
- transaction・保持・通知: [DB 規約](db-rule.md#durable-state-rules)
- parent / child と受付調停: [Worker 規約](worker-rule.md#ocr-capability)
- 利用者から見た受付・再試行・通知: [基本要求の OCR・下書き](requirements/base.md#6-ocr下書き)

## Ownership

API は job、受付時の入力 snapshot、下書きとの関連を同じ DB transaction で保存する。Worker 親プロセスは DB の job を直接取得し、共有実行枠、lease、子プロセス、結果確定、再試行、期限回復を所有する。子プロセスは1回の計算結果だけを返す。ジョブ配送専用の outbox は使わない。

永続状態は既存の `ocr_jobs` に置く。メモリが保持するのは「DB を再確認する」という起床通知だけであり、job の一覧と実行順序の正本は DB とする。分析も同じ DB と共有実行枠を使うが、入力検証と状態遷移は種類ごとに所有する。

## Immutable Input

- `input_snapshot` は受付時に補完済みの hints、画像識別情報と、指定された場合の `requestId` を含む。再試行時も、最新の別名や下書きではなく受付時の内容をそのまま使う。
- 入力 v2 の field、型、上限、列挙値は schema を正本とする。実行回数と受付時刻は DB の `attempt_count` / `created_at` を正本とし、入力 snapshot から分離する。
- 非公開 object の opaque key と取得後の検証 metadata を保存する。object key に local path、URL、bucket、endpoint、credential を含めず、filesystem path として連結しない。
- Worker は job / snapshot / source image の識別情報を照合し、取得 bytes の length、media type、checksum を OCR 前に再検証する。
- `ocrHintsJson` は補助情報であり、画面種別、player、OCR 結果の正本にしない。API は受付時に不足する既定別名を補い、登録済み別名を統合してから上限を検証する。CPU 名が未指定または空の場合の作品方式ごとの既定値は Worker が補い、明示値はそのまま使う。
- 実行対象の job には snapshot を必須とする。旧終端履歴は snapshot なしでも保持できるが、実行入力になるのは snapshot を持つ job だけとする。

`layoutFamily` は `momotetsu_2`、`world`、`reiwa` の3値を正規値とする。既知の旧表記は ASCII の大小文字と前後空白を解決し、`momotetsu2` / `2` を `momotetsu_2`、`momotetsu_world` / `default` を `world`、`momotetsu_reiwa` を `reiwa` として読む。hint の省略だけが方式の自動選択を表し、文字列 `auto`、空文字、未知値は新規受付で拒否する。

API の作品・試合・下書き scalar と Web の新規 hint は正規値で保存する。受付済み submission の完全一致 replay と job の immutable snapshot は旧表記を保持し、Worker は実行時に解決する。正規化の際も、保存済み hint、OCR profile ID、画像識別情報はそのまま保つ。共通の受理・拒否例は `docs/schemas/fixtures/ocr-worker/layout-families-v1.json` を Scala・TypeScript・Rust で検証する。

## Acceptance and Wake

HTTP success が保証するのは入力と業務状態の DB commit までとし、Worker の開始や外部通知の完了はそれぞれ別の状態として扱う。

- job / snapshot / 下書き / submission member を同じ transaction で保存する。active job 上限は transaction lock 取得後の statement で最新件数を検査する。lock 待機前の snapshot を同じ CTE 内で使わない。
- 受付判定は queued / running 件数と、実行可能になった queued job の待ち時間を使う。将来の再試行と現在の滞留を区別し、過去の failed 履歴を backlog に含めない。
- process-local wake は commit 後に限って送る。外部の payloadless PostgreSQL 通知は API が所有する非同期 relay で HTTP 応答と独立に処理する。
- 通知は低遅延化の hint とする。通知が失敗・欠落しても受付は有効のまま保ち、Worker の起動時・再接続時・期限到来時・低頻度走査で回収する。listener の接続と起動確認は [Worker 規約](worker-rule.md#runtime--listener--shutdown) に従う。

## Claim and Execution

- scheduler は各 job lease の期限切れを、新しい queued job がなくても回復する。候補は DB 時刻と `available_at` を使って上限付きで選ぶ。
- 実行権は候補選択ではなく claim で得る。claim は下書き → job の順で lock を取り、状態・入力・実行可能時刻を再検証する。OCR の `lease_fencing_token` は終端・再 queue でも保持し、新しい claim と同じ transaction で checked +1 する。上限では claim を拒否する。
- child は claim の commit 成功を確認してから起動する。旧 owner の更新を fence で拒否する一方、物理的な child 停止は parent の実行管理と process adapter が担う。
- 使用中の枠、重複 wake、未到来の期限は正常な待機として扱う。非対応の分析 job や lock 中の先頭候補があっても、対応する後続 job の走査を続ける。
- 実行可能な待機候補では OCR を分析より先に選ぶ。実行中の分析は完了させ、child の回収後に次の候補を取得する。この優先順は OCR・分析の待ち時間上限を保証するものではない。
- 結果の検証、OCR draft 保存、job 終端、下書き表示状態の更新を同じ整合性境界で確定する。成功とするのは DB write を含む確定処理の成功を確認した場合に限る。
- listener と job lease heartbeat は child の完了待ちの間も動かし続ける。実行中の job が占有するのは自 Worker の実行資源だけとする。

## Retry, Recovery and Maintenance

| 状況 | 永続状態と処理 |
| --- | --- |
| 一時的な実行失敗 | `failure_retry_count` の予算内で将来時刻の queued へ戻す。予算を使い切れば終端化する |
| owner の lease 切れ | `lease_recovery_count` の別予算で回復し、実行失敗とは別に数える |
| 正常停止・旧世代の中断 intent | child を回収し、job を queued へ戻す。失敗・lease 回復の予算はそのまま保つ |
| 不正入力・再試行しない実行失敗 | 安全な理由を保存して終端化し、後続 job を処理する |
| stale queued / owner を失った実行 | Worker の期限処理で収束する。この期限回復の対象は実行権を失った job に限り、有効な lease を持つ実行を別 timer で失敗にしない |
| 全 job が終端でも下書きが実行中 | Worker が下書き状態を修復する |

`attempt_count` は実際の実行権取得回数だけを数える。再試行・lease 回復はそれぞれの予算で管理する。Worker 停止中の job は DB に保持され、復旧後に期限処理する。受付側の backlog 制限はその間も有効とする。

待機期限は次の実行可能時刻、lease 回復、保守、補完走査から決める。枠が使用中の間は次の期限まで待ち、過去の `available_at` を繰り返し選ぶ hot loop を避ける。hint があっても backoff と既存の期限に従う。

## Compatibility and Verification

入力形式、状態遷移、保存必須条件の非互換変更では、対応する API・Worker・DB を一つの移行計画で切り替える。過去の失敗コードの読み取りと、旧 consumer の並行稼働は別の契約とする。

品質証拠は [テスト・品質規約](test-rule.md#processing-worker-evidence-catalog) の採用基準で選ぶ。本契約を変更した場合に直接通す production boundary は次のとおりで、変更に該当する行だけを選び、未実行の境界は未検証として扱う。

| 変更 | 直接通す境界 |
| --- | --- |
| 入力 schema、hints（input snapshot の受理・拒否） | 共有入力 fixture を schema、Scala、Rust の各 validator に通す |
| layoutFamily の正規値・旧表記の解決 | `layout-families-v1.json` を Scala、TypeScript、Rust の各 resolver に通す。Web の新規 hint の正規化を含む |
| 受付 transaction、backlog 判定 | 実 PostgreSQL で受付の原子性、上限判定、rollback 時の wake 抑止 |
| claim、fence、lease、再試行予算 | 実 PostgreSQL で claim 競合、古い fence の拒否、retry と lease 回復の別予算、期限切れ実行だけが残る場合の回復 |
| listener、wake | 実 PostgreSQL と production と同じ pooling mode で通知欠落・再接続からの回収 |
| 優先順、child の停止・回収 | Linux の実 process で待機 OCR の優先、実行中の分析の継続、child の停止・回収 |
| 画面への反映、再操作 | 主要 E2E（[開発作業規約の E2E Suites](dev-rule.md#e2e-suites)） |

診断とログの制約は [アーキテクチャの Runtime / Security](architecture.md#runtime--security) に従う。
