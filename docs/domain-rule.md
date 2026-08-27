# ドメインルール

目的: コードや DB shape だけでは決められない用語、不変条件、状態遷移、識別子の意味を定義する。CSV / TSV は `docs/requirements/base.md`、DB 所有権は `docs/db-rule.md`、queue は `docs/redis-streams-ocr-contract.md` を正本とする。

## 1. Terms

| 用語 | 意味 |
| --- | --- |
| 開催回 | 1夜の桃鉄会。複数試合を含み得る。 |
| 試合 | 開催回に属する確定済みの1年勝負。 |
| 下書き | OCR または手入力から確定前に編集する作業単位。 |
| OCRドラフト | 画像1枚の解析結果。 |
| OCRジョブ | 画像受付から OCR 完了 / 失敗までの非同期処理。 |
| 戦績分析ジョブ | 1作品の有効 scope と表示用途を再計算する非同期処理。 |
| 戦績分析成果物 | 比較、振り返り、drilldown が共有する version 付き計算結果。 |
| 試合メモ | 確定済みの1試合に0件または1件だけ付けられ、認可済み利用者全員で共有する自由記述。 |
| プレーヤー | summit と共有する固定4名の試合参加者。 |
| ログインアカウント | 認証・認可される操作主体。プレーヤーとは別概念。 |
| エイリアス | OCR 上の名前をプレーヤーへ解決する対応。 |

## 2. Actors

- ログインアカウントはプレーヤーではない。任意のプレーヤーへ紐づけられるが、紐づかない認可済みアカウントも操作できる。
- 作成者は account を正とし、対応プレーヤーがある場合だけ member も記録する。
- 管理者は最低1名の有効状態を維持する。ログイン無効化時は既存 session も無効にする。
- dev/test の主体選択を本番認証として扱わない。

## 3. Match Invariants

- 試合は開催回内で一意な1始まりの試合番号を持つ。
- 試合参加者は固定4名ちょうどで、member、順位 `1..4`、プレー順 `1..4` はそれぞれ重複しない。
- 順位は資産額から推測せず入力値を正とする。画像由来のプレー順は画面上の並びから判定でき、手修正できる。
- 開催日時、作品、season、owner、map と4名分の順位・プレー順が揃うまで確定しない。
- 資産・収益は万円単位の整数、事件回数は0以上の整数とする。表示形式は UI の責務とする。
- 試合メモは確定の必須条件ではなく、上限150 Unicode code pointsのplain textとする。入力、更新、分析境界は `docs/requirements/match-note.md` を正本とする。
- 固定メンバー構成を変える場合は局所定数の変更ではなく、共有 master と API 契約を含む設計変更として扱う。

## 4. Draft / Match Confirmation Modes

| 下書き状態 | 意味 | 編集 | 終端 |
| --- | --- | --- | --- |
| `ocr_running` | OCR slot が待機中または処理中 | 不可 | No |
| `ocr_failed` | slot の一部が失敗または cancel | 可 | No |
| `draft_ready` | 警告なく編集可能 | 可 | No |
| `needs_review` | OCR 警告の確認が必要 | 可 | No |
| `confirmed` | 確定済み試合へ閉じた | 不可 | Yes |
| `cancelled` | 互換用の中止終端 | 不可 | Yes |

- OCR slot は `total_assets`、`revenue`、`incident_log` を明示する。legacy decode を除き `auto` を受理しない。同じ slot の再取込は最新結果で置き換える。
- 投影状態の優先順は未完了、失敗、警告、ready とする。OCR 失敗後も手入力で続行できる。
- 未確定下書きの削除は画像保持も閉じる。`confirmed` は試合作成と同じ usecase でだけ到達し、終端状態から再開しない。
- 画像なしの直接確定は下書きを変更しない。OCR 下書きからの確定は `matchDraftId` で作業単位を閉じ、参照した各 OCR draft が現在 slot と一致することを確認する。
- OCR draft ID は解析結果の来歴であり、下書きを閉じる識別子の代わりにしない。

## 5. OCR Job

| 状態 | 意味 | 終端 |
| --- | --- | --- |
| `queued` | 配送待ちまたは未 claim | No |
| `running` | worker が処理中 | No |
| `succeeded` | draft を保存済み | Yes |
| `failed` | 失敗を保存済み | Yes |
| `cancelled` | 処理前に中止 | Yes |

- 状態の正本は DB、Redis Streams は配送路とする。
- claim と terminal 遷移は atomic に行い、terminal は `queued` / `running` からだけ許可する。
- success は保存した draft と報告値が一致する。non-success は failure metadata を持ち、draft payload を持たない。

## 6. Series Analysis Job

| 状態 | 意味 | 終端 |
| --- | --- | --- |
| `queued` | 実行または preemption 後の再実行待ち | No |
| `running` | lease を持つ attempt が処理中 | No |
| `succeeded` | 対象 version を原子的に公開済み | Yes |
| `failed` | 非再試行失敗または retry 上限 | Yes |
| `timed_out` | hard timeout | Yes |

- 試合確定、確定済み試合の分析入力となる項目の更新、試合削除は、対象作品の再計算 intent と同じ transaction で確定する。初版の試合メモだけの更新は分析入力を変えず、再計算 intent を作らない。
- 1 job は同じ入力 snapshot から1作品を計算し、部分成果物を公開しない。失敗や timeout は直前成功成果物を変更しない。
- 対象なし、分母0、件数不足、定義済みの model 非採用は、品質状態を持つ正常成果物とする。予期しない scope 失敗は job 全体を失敗させる。
- OCR による preemption だけ `running -> queued` を許可し、失敗回数へ加算しない。分析から OCR を preempt しない。
- 入力 version、algorithm version、artifact schema version を混同しない。詳細な job / artifact 要求は `docs/requirements/series-analysis-batch.md` を正本とする。

## 7. Masters / Held Events

- master は `momo-db` が所有する。map / season は所属作品と整合し、OCR name alias は解決先を曖昧にしない。
- layout family は OCR profile の安定した lowercase snake key とする。
- 1開催回に複数試合を持てる。参照中の試合または有効な下書きを解消せず開催回を削除しない。
