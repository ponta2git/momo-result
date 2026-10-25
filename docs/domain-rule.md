# ドメイン規約

目的: 用語、不変条件、状態遷移、識別子の意味を定義する。CSV / TSV と認証・権限は [基本要求](requirements/base.md)、試合メモは [試合メモ要求](requirements/match-note.md)、DB の保存形と transaction は [DB 規約](db-rule.md)、OCR job の受付・実行・回復は [OCR job 契約](ocr-job-contract.md)、分析 job / artifact は [分析 batch 要求](requirements/series-analysis-batch.md) を正本とする。

## Terms

| 用語 | 意味 |
| --- | --- |
| 開催回 | 1夜の桃鉄会。複数試合を含み得る。 |
| 試合 | 開催回に属する確定済みの1年勝負。 |
| 対戦日時 | その試合を行った日時。所属開催の日時を初期値にでき、異なる値も持てる。 |
| 下書き | OCR または手入力から確定前に編集する作業単位。 |
| OCRドラフト | 画像1枚の解析結果。 |
| OCRジョブ | 画像受付から OCR 完了 / 失敗までの非同期処理。 |
| OCR送出 | 1回の読み取り操作で固定した1〜3画像の集合。全体の結果と通知の単位。 |
| 戦績分析ジョブ | 1作品の有効 scope と表示用途を再計算する非同期処理。 |
| 戦績分析成果物 | 比較、振り返り、drilldown が共有する version 付き計算結果。 |
| 試合メモ | 確定済みの1試合に0件または1件だけ付けられ、認可済み利用者全員で共有する自由記述。 |
| プレーヤー | summit と共有する固定4名の試合参加者。 |
| ログインアカウント | 認証・認可される操作主体。プレーヤーとは別概念。 |
| エイリアス | OCR 上の名前をプレーヤーへ解決する対応。 |

## Actors

- ログインアカウントはプレーヤーとは別の主体である。任意のプレーヤーへ紐づけられ、紐づきのない認可済みアカウントも操作できる。
- アカウントのロールと付与・操作権限は [基本要求の認証・権限](requirements/base.md#3-認証権限) を正本とする。
- 作成者は account を正とし、対応プレーヤーがある場合だけ member も記録する。
- 管理者は最低1名の有効状態を維持し、ロールとアカウントを常に管理できる状態を保つ。ログイン無効化時は既存 session も無効にする。
- dev / test の主体選択は dev / test に限り、本番認証とは区別する。

## Match Invariants

- 試合は開催回内で一意な1始まりの試合番号を持つ。
- 試合参加者は固定4名ちょうどで、member、順位 `1..4`、プレー順 `1..4` はそれぞれ重複しない。
- 順位は資産額からの推測ではなく入力値を正とする。画像由来のプレー順は画面上の並びから判定でき、手修正できる。
- 確定には、対戦日時、作品、season、owner、map と4名分の順位・プレー順がすべて揃っていることを必要とする。
- 資産・収益は万円単位の整数、事件回数は0以上の整数とする。表示形式は UI の責務とする。
- 試合メモは確定の必須条件ではなく、上限150 Unicode code points の plain text とする。入力、更新、分析境界は [試合メモ要求](requirements/match-note.md) を正本とする。
- 固定メンバー構成を変える場合は局所定数の変更ではなく、共有 master と API 契約を含む設計変更として扱う。
- 分析完了通知の順位・銀次は公開した追加・変更試合の保存値とする。分析結果は成果物 ID、通知の発生は論理ジョブ ID で識別する。通知の比較元・対象集合・固定時点は [分析 batch 要求](requirements/series-analysis-batch.md#分析完了通知) を正本とする。

## Draft / Match Confirmation Modes

| 下書き状態 | 意味 | 編集 | 終端 |
| --- | --- | --- | --- |
| `ocr_running` | OCR slot が待機中・処理中、または画像がまだない最初の送出を受付済み | 不可 | No |
| `ocr_failed` | slot の一部が失敗または cancel | 可 | No |
| `draft_ready` | 警告なく編集可能 | 可 | No |
| `needs_review` | OCR 警告の確認が必要 | 可 | No |
| `confirmed` | 確定済み試合へ閉じた | 不可 | Yes |
| `cancelled` | 互換用の中止終端 | 不可 | Yes |

- OCR slot は `total_assets`、`revenue`、`incident_log` を明示する。`auto` の受理は legacy decode に限る。同じ slot の再取込は最新結果で置き換える。
- 新規 OCR ジョブは受付済み送出の固定 member と対戦下書きの slot へ紐づく。OCR レコードを作るのは、送出 ID が有効で、member が受付済みで、主体と内容が一致し、存在する非終端の下書きへの新規受付である場合に限る。登録済み member の同一再送は既存 job へ収束する。
- 読み取り用下書きも最初は `draft_ready` で作り、送出の受付前に通信が止まっても編集可能な記録を残す。空の下書きを `ocr_running` へ移すのは送出受付と同じ transaction とし、既存結果 slot がある下書きは job 登録までは現在の状態を保つ。初回送出が画像 job 0件で終了した場合は `ocr_failed` へ移し、後の送出や結果はそのまま保つ。
- 投影状態の優先順は未完了、失敗、警告、ready とする。OCR 失敗後も手入力で続行できる。
- 未確定下書きの削除は画像保持も閉じる。`confirmed` は試合作成と同じ usecase でだけ到達し、終端状態は以後変わらない。
- 画像なしの直接確定では下書きをそのまま保つ。OCR 下書きからの確定は `matchDraftId` で作業単位を閉じ、参照した各 OCR draft が現在 slot と一致することを確認する。経路ごとの副作用は [基本要求の試合確定の2経路](requirements/base.md#74-試合確定の2経路) を正本とする。
- OCR draft ID は解析結果の来歴であり、下書きを閉じる識別子は `matchDraftId` とする。

## OCR Job

| 状態 | 意味 | 終端 |
| --- | --- | --- |
| `queued` | 実行待ち、または一時失敗後の再実行待ち | No |
| `running` | worker が処理中 | No |
| `succeeded` | draft を保存済み | Yes |
| `failed` | 失敗を保存済み | Yes |
| `cancelled` | 処理前に中止 | Yes |

- claim と terminal 遷移は atomic に行い、terminal は `queued` / `running` からだけ許可する。
- success は保存した draft と報告値が一致する。`failed` は failure metadata を持ち、`cancelled` は持たない。draft payload を持つのは success だけとする。
- 受付、claim、再試行、期限回復の契約は [OCR job 契約](ocr-job-contract.md) を正本とする。

### OCR送出

`open` は固定 member の受付または処理終了を待つ状態、`settled` は Worker が全体を確定した状態、`aborted` は下書きの確定・取消・削除で無効になった状態。`settled` と `aborted` は終端であり、以後 open へは戻らない。

member は未登録の `pending`、job に結び付いた `registered`、登録できず終了した `failed` に分ける。registered の完了判断は、現在の下書き slot ではなく対応 job の不変な終端状態を使う。

受付期限は画像処理期限と分離し、未登録枠だけを終了させる。一時的な転送・HTTP 失敗の時点では、受付の成否を未確定として扱う。全体確定後の再読み取りは新しい送出で行う。

## Series Analysis Job

job は1作品の計算を管理し、attempt は lease を持つ1回の実行を表す。attempt の終了は job の終端とは限らない。状態と再実行条件は [分析 batch 要求の Job / Delivery](requirements/series-analysis-batch.md#3-job--delivery) を正本とする。

- 試合確定、確定済み試合の分析入力となる項目の更新、試合削除は、対象作品の再計算 intent を作る。初版の試合メモだけの更新は分析入力を変えず、再計算 intent を作らない。業務状態と intent を同じ transaction で確定する規則は [DB 規約](db-rule.md#durable-state-rules) に従う。
- 1 attempt は一貫した入力 snapshot から1作品を計算し、完成した成果物だけを公開する。失敗や timeout の後も直前成功成果物を保つ。
- 対象なし、分母0、件数不足、定義済みの model 非採用は、品質状態を持つ正常成果物とする。予期しない scope 失敗は job 全体を失敗させる。
- 入力 version、algorithm version、artifact schema version、validation contract ID、radar basis / generation は、それぞれ別の識別として扱う。各 version の意味は [分析 batch 要求](requirements/series-analysis-batch.md#2-version--recalculation-intent) を正本とする。

## Masters / Held Events

- master は `momo-db` が所有する。map / season は所属作品と整合し、OCR name alias は解決先を一意に定める。
- layout family は OCR profile の安定した lowercase snake key とする。正規値と旧表記の解決は [OCR job 契約](ocr-job-contract.md#immutable-input) を正本とする。
- 1開催回に複数試合を持てる。開催回の削除は、参照中の試合と有効な下書きをすべて解消してから行う。
