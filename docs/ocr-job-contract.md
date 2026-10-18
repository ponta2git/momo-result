# OCR Job Contract

目的: API が保存する OCR 入力、Worker の直接取得、実行・再試行・回復の意味を定義する。入力の shape / limit は JSON Schema、DB shape は `../momo-db`、時間と回数の現在値は runtime 設定を正本とする。

関連正本:

- 入力: `docs/schemas/ocr-job-input-v2.schema.json`
- hints: `docs/schemas/ocr-hints-v1.schema.json`
- 状態遷移: `docs/domain-rule.md`
- transaction: `docs/db-rule.md`
- parent / child: `docs/architecture.md`
- 検証: `docs/test-rule.md`、`docs/dev-rule.md`

## 1. Ownership

API は job、受付時の入力 snapshot、下書きとの関連を同じ DB transaction で保存する。Worker 親プロセスは DB の job を直接取得し、共有実行枠、lease、子プロセス、結果確定、再試行、期限回復を所有する。子プロセスは1回の計算結果だけを返す。ジョブ配送専用の outbox は使わない。

永続状態は既存の `ocr_jobs` に置く。メモリには「DB を再確認する」という起床通知だけを保持し、job の全件一覧や実行順序を正本として持たない。分析も同じ DB と共有実行枠を使うが、入力検証と状態遷移は種類ごとに所有する。

## 2. Immutable Input

- `input_snapshot` は受付時に補完済みの hints、画像識別情報、`requestId` を含む。再試行時に最新の別名や下書きから再構築・上書きしない。
- 入力 v2 の field、型、上限、列挙値は schema に従う。各値は string とし、未知 field、非 string value、不正な version を拒否する。実行回数と受付時刻は DB の `attempt_count` / `created_at` を正本とし、入力へ複製しない。
- 非公開 object の opaque key と取得後の検証 metadata を保存する。object key に local path、URL、bucket、endpoint、credential を含めず、filesystem path として連結しない。
- Worker は job / snapshot / source image の識別情報を照合し、取得 bytes の length、media type、checksum を OCR 前に再検証する。
- `requestedScreenType` を明示し、新規入力は `auto` を受理しない。
- `ocrHintsJson` は補助情報であり、画面種別、player、OCR 結果の正本にしない。API は受付時に不足する既定別名を補い、登録済み別名を統合してから上限を検証する。CPU 名が未指定または空の場合の作品方式ごとの既定値は Worker が補い、明示値は変更しない。
- 実行対象の job には snapshot を必須とする。旧終端履歴には snapshot なしを許すが、新しい実行入力として扱わない。

`layoutFamily` は `momotetsu_2`、`world`、`reiwa` の3値を正規値とする。既知の旧表記は ASCII の大小文字と前後空白を解決し、`momotetsu2` / `2` を `momotetsu_2`、`momotetsu_world` / `default` を `world`、`momotetsu_reiwa` を `reiwa` として読む。hint の省略だけが方式の自動選択を表し、文字列 `auto`、空文字、未知値は新規受付で拒否する。

API の作品・試合・下書き scalar と Web の新規 hint は正規値で保存する。受付済み submission の完全一致 replay と job の immutable snapshot は旧表記を保持し、Worker は実行時に解決する。正規化のために保存済み hint、OCR profile ID、画像識別情報を変更しない。共通の受理・拒否例は `docs/schemas/fixtures/ocr-worker/layout-families-v1.json` を Scala・TypeScript・Rust で検証する。

## 3. Acceptance and Wake

HTTP success は入力と業務状態の DB commit を意味し、Worker の開始や外部通知の完了を意味しない。

- job / snapshot / 下書き / submission member を同じ transaction で保存する。active job 上限は transaction lock 取得後の statement で最新件数を検査する。lock 待機前の snapshot を同じ CTE 内で使わない。
- 受付判定は queued / running 件数と、実行可能になった queued job の待ち時間を使う。将来の再試行と現在の滞留を区別し、過去の failed 履歴を backlog に含めない。
- commit 後に process-local wake を送る。外部の payloadless PostgreSQL 通知は API が所有する非同期 relay で処理し、HTTP 応答を待たせない。rollback では wake しない。
- 通知は低遅延化の hint とする。通知失敗や欠落で受付を取り消さず、Worker の起動時・再接続時・期限到来時・低頻度走査で回収する。
- listener は session-capable な専用接続を使い、購読を確立してから初回走査する。起動時には別接続からの通知 round trip を確認する。

## 4. Claim and Execution

- scheduler は共有実行枠の期限切れを、新しい queued job がなくても回復する。候補は DB 時刻と `available_at` を使って上限付きで選ぶ。
- 候補選択は実行権を与えない。claim は共有枠 → 下書き → job の順で lock を取り、状態・入力・実行可能時刻を再検証して lease と fence を確定する。
- claim の commit 成否が不明なら child を起動しない。旧 owner の更新を fence で拒否する一方、物理的な child 停止は parent の実行管理と process adapter が担う。
- 使用中の枠、重複 wake、未到来の期限を失敗にしない。非対応の分析 job や lock 中の先頭候補で、対応する後続 job の走査を止めない。
- OCR は分析に中断を要求できる。旧 child の回収と durable な再queueを確認してから枠を譲る。この優先制御だけで分析の待ち時間上限を保証したと扱わない。
- 結果の検証、OCR draft 保存、job 終端、下書き表示状態の更新を同じ整合性境界で確定する。DB write 失敗を成功扱いにしない。
- listener、lease heartbeat、preemption 監視を child の完了待ちで止めない。

## 5. Retry, Recovery and Maintenance

| 状況 | 永続状態と処理 |
| --- | --- |
| 一時的な実行失敗 | `failure_retry_count` の予算内で将来時刻の queued へ戻す。予算を使い切れば終端化する |
| owner の lease 切れ | `lease_recovery_count` の別予算で回復する。実行失敗と同じ回数に混ぜない |
| 正常停止・優先制御による中断 | child を回収し、job を queued へ戻す。失敗・lease 回復の予算を消費しない |
| 不正入力・再試行しない実行失敗 | 安全な理由を保存して終端化し、後続 job を処理する |
| stale queued / owner を失った実行 | Worker の期限処理で収束する。有効な lease を持つ実行を別 timer で失敗にしない |
| 全 job が終端でも下書きが実行中 | Worker が下書き状態を修復する |

`attempt_count` は実際の実行権取得回数を表す。再試行・lease 回復の予算とは分ける。配送回数や wake 回数を代用しない。Worker 停止中の job は DB に保持され、復旧後に期限処理する。受付側の backlog 制限はその間も有効とする。

待機期限は次の実行可能時刻、lease 回復、保守、補完走査から決める。枠が使用中の間に過去の `available_at` を繰り返し選んで hot loop しない。hint は backoff や既存の期限を延長・迂回しない。

## 6. Compatibility and Verification

入力形式、状態遷移、保存必須条件の非互換変更では、対応する API・Worker・DB を一つの移行計画で切り替える。過去の失敗コードの読み取りと、旧 consumer の並行稼働は別の契約とする。

共有入力 fixture を schema、Scala、Rust に通す。実 PostgreSQL で受付の原子性、claim 競合、古い fence、retry、期限切れ実行だけが残る場合、通知欠落・再接続を確認する。child の停止・回収・preemption は Linux の実 process で確認する。画面への反映と再操作は主要 E2E で確認し、未実行の境界を通過扱いにしない。

診断は job / attempt の安全な識別子、状態、待機時間、失敗理由を使う。画像内容、OCR raw text、認証情報、DB 接続 URL を log や public docs に出さない。
