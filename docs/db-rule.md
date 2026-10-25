# DB 利用規約

目的: 共有 PostgreSQL の所有権、永続状態の意味、consumer contract、DB contract evidence、migration 順序、移行中の契約を判断する。DDL の現在値は `momo-db`、query の現在値は各 consumer、検証コマンドは [開発作業規約](dev-rule.md#commands) を正本とする。

row の業務意味と状態遷移は [ドメイン規約](domain-rule.md)、試合メモは [試合メモ要求](requirements/match-note.md)、分析 job / artifact は [分析 batch 要求](requirements/series-analysis-batch.md)、実績は [実績要求](requirements/player-achievements.md) を正本とする。

## Ownership

- schema、migration、seed は別 repository の `momo-db` が所有し、migration SQL も `momo-db` にだけ置く。
- 変更・DB 操作に用いる `momo-db` checkout は、依頼の指定や既知の配置から特定する。`../momo-db` は通常の配置例であり、worktree では元の作業ツリーなどの配置を確認する。隔離 test 用の pinned checkout・migration source は、変更対象とは区別して確認する。`momo-db` 側を変更する前の手順は [AGENTS.md](../AGENTS.md#作業境界) に従う。
- この repository は API / worker の query と、選択した DB contract evidence を所有する。
- migration の存在と接続先への適用済み状態は別々に確認する。
- Testcontainers、CI、E2E は `momo-db` の migration を適用した DB を使う。隔離 test の既定 migration source の解決は [開発作業規約の Environment](dev-rule.md#environment) に従う。

## Durable State Rules

- 画像について DB に保存するのは非公開の opaque object key と検証・保持 metadata に限り、画像実体、bucket / public URL、credential、OCR raw text 全文は DB 契約の外に置く。
- OCR job の terminal 遷移が下書き表示状態を変える場合は、両方を同じ transaction で更新する。read は保存済みの下書き表示状態を使い、job 履歴からは再構成しない。
- 試合確定、確定済み試合の分析入力となる項目の更新、試合削除と、対象作品の分析再計算 intent は同じ transaction で確定する。初版の試合メモだけの更新では、分析 input revision、再計算 intent、job をそのまま保つ。
- 試合メモの本文または absence、最終更新 account、最終更新日時、concurrency version は同じ write で確定する。メモ更新日時は構造化された試合の更新日時と分離する。構造化された試合更新はメモ状態を保持し、メモの競合は時刻ではなく concurrency version で検出する。
- job / request writer は外部 I/O を transaction の外に置き、commit 後にだけ typed wake を返す。業務 transaction の確定は通知の成否から独立させる。
- 分析の有効な algorithm / artifact schema / validation contract の組は release singleton を正本とする。作品作成は singleton を `FOR SHARE` で固定し、作品と title state を同じ transaction で明示保存する。新規作品の version は各 consumer の定数ではなく singleton から得る。
- 分析成果物の current / previous の確認と chunk read は cleanup と競合しない read 境界で行う。
- 分析の published artifact header と child resource は改変不能とし、consumer の検証に加えて DB の guard でも守る。この不変性は恒久の契約であり、移行の完了後も維持する。staging の作成・差し替え、attempt 保持 cleanup による許可済み provenance 変更、参照されない parent からの cascade cleanup を、公開内容の単独変更と区別する。DB の guard を別の仕組みへ置き換える場合は、[Contract Evidence](#contract-evidence) の publication の各経路を実 PostgreSQL で検証し、撤去順を決めてから行う。
- 実績の定義・直接入力と移行の根拠・廃止履歴は `momo-db` に保存する。根拠は項目・プレーヤー・入力元ごとの現在の申告であり、取消時も保持する。編集版と申告の世代を分け、同じ申告の訂正は世代を維持し、取消後に別試合から新規入力するときは新しい世代にする。取消・訂正を反映した現在の申告を保持し、初達成は有効な根拠から決め直せるようにする。判断条件は [実績要求](requirements/player-achievements.md#3-入力と達成判定) に従う。
- 自動実績の廃止履歴は、定義と4人の統合結果を持つ独立した業務 snapshot として保存する。手入力の下位項目を廃止するときは、その時点で補完元となる根拠 ID・世代だけを固定する。いずれも通常の分析 artifact 整理から独立して保持し、全編集履歴や有効項目の派生行は蓄積しない。
- OCR の Discord 通知は送出全体の確定、分析通知は分析成功時点の固定 snapshot を持つ。対象下書きの確定・取消・削除と open 送出の aborted 化・通知の未開始部分取消は同じ業務 command で commit する。掲載試合の削除も未開始通知の取消と同時に扱う。通知本文は確定時点の内容に固定し、後日のメモ編集や元 job の整理の後もそのまま保つ。
- 送出の owner・固定 member・受付期限・終端識別を保持し、source 下書き削除後も同一操作の照合を可能にする。未確定送出の job と、受付期限内の upload 済み / job 未登録画像を保持処理から保護する。保存形・一意性・参照制約は momo-db、受付・失敗・確定の業務判断は API / Worker が所有する。

## Consumer Contract

本節は実装が守る契約であり、test の選択によらず適用する。

### Locks and Transactions

- 大容量 staging は長い control lock から分離し、短い fenced transaction で完全性を再検証してから公開する。
- 分析 claim / publication の lock 順は title state、job、request / artifact とし、複数 title state は作品 ID 順に取得する。実行資源の予約は各 Worker process が所有し、DB の共有 slot を取得しない。共有 slot は再導入しない。
- 試合と実績を変更する API は、影響する開催、試合、実績項目、根拠、title state の順に lock する。同じ種類の複数行は ID 順に取り、開催の全 membership を固定してから変更前後の影響作品を求める。実績廃止もこの順序に参加し、title state 取得後に元試合の lock へ戻らない。
- `series_analysis_jobs.fencing_counter` は claim と同じ transaction でのみ増やす。heartbeat・再 queue・回収・終端・attempt 履歴削除の後も値を維持し、上限では新しい claim を拒否する。値を維持することで、lease を失った旧 owner の更新・公開を世代をまたいで拒否できる。
- campaign 集計は target 更新と同じ READ COMMITTED transaction に置き、campaign 行を ID 順の `FOR NO KEY UPDATE` で取得してから別 statement で再集計する。lock 待ちを含む集計 UPDATE 単独では待機前の snapshot を使うため、別作品の commit を取りこぼす。FK 挿入の KEY SHARE とは競合させない。
- 分析 release promotion は release advisory lock、reader capability registry、worker capability registry、release singleton、作品 ID 順の title state の順で lock する。capability registry は判定後の登録・heartbeat 割込みを commit まで遮断し、singleton 更新と既存 title 更新を同じ transaction で確定する。
- queued な通常分析 job の radar basis / generation は、title state lock を保持した transaction 内で API / Worker 共通の job transition（Scala と Rust の `bindQueuedRadar` 相当）が明示代入する。API の試合 mutation・手動要求・radar apply / withdraw / 入力無効化、Worker の campaign・follow-up・release promotion・supersede・retry・中断・lease 回収が対象。running と radar preparation の snapshot は維持する。同じ組への代入は UPDATE を省き、再実行でも世代・attempt 数を保つ。
- running から queued または terminal への全遷移は、owner・attempt・fencing token・期限と `lease_validation_contract_id` を一緒に明示 clear する。成功、radar preparation 完了、通常失敗、retry 上限、lease 回収上限にも同じ契約を適用する。
- artifact の current contract、outlook scope / count、payload 間の意味整合性は Rust の full validator（`ValidatedArtifact` を生成する）に集約する。staging 保存後は manifest との全 metadata / count 一致を確認してから seal し、公開時に再確認する。previous pointer は同じ作品・schema・validation contract の published artifact だけを保持する。DB には参照整合性、desired tuple の一致、sealed / published 内容の不変性を残す。
- 複数 statement で一つの読み取り結果を組み立てる repository は、read-only / repeatable-read の snapshot を所有する。読み取り専用の設定はその repository の境界で適用し、write transaction からも呼ばれる共通 SQL 部品（API では write に合成する `ConnectionIO`）から分離する。
- `LISTEN` など session state を持つ consumer は、session-capable 接続を通常 query 接続から分離する。
- transaction pooler を通る query は、timeout などの設定と排他を必要な transaction 内で完結させ、transaction scope の設定と lock だけを使う。pool 接続の再利用、session-capable 接続、通知の機能 round trip を別の契約として検証する。

### Identifiers and Decoding

- mutable entity の保存 ID / FK は native UUID とし、既存の外部 ID は保存された `legacy_id` または保持用 `legacy_*` から復元する。入力 ID は exact alias lookup で解決し、未登録の参照や認証主体を hash で補完しない。新規の構造化 job / attempt ID の割当だけが、momo-db の固定 namespace と共有 fixture に従う mapper を使う。
- immutable な分析 artifact / radar basis の payload・header・chunk・revision は従来の text ID と checksum を保持する。可変状態からの UUID 参照は型付き identity table を経由し、新規 artifact / basis と identity は同じ transaction で保存する。計算入力、整列、tie-breaker、snapshot は保存された旧 ID の byte 列を使う。mutable storage を UUID にしても、既存の外部 ID、冪等 replay、immutable 成果物の byte と checksum を保つためである。
- Worker は通常接続時に UUID / legacy 列、identity の一意性、FK と保持値の NULL 対応を検査し、旧 schema や部分適用状態への write を拒否する。API は起動時の read-only snapshot で legacy / canonical の schema 契約を検証する（[API 規約](api-rule.md#bootstrap--http-execution)）。これらの実行時検査は canonical identity への切替手順の完了後も恒久の契約として継続する。API が受理する mode は対応する consumer 契約に従い、legacy mode の受理をやめる場合は、その検査と legacy 境界の証拠（[テスト実行設計](test-architecture.md#api--worker-の実行境界)）を同じ変更で見直す。

### Notifications

- 通知の業務判断と更新単位はアプリが所有し、通知用 stored function・trigger ではなくアプリのコードで実装する。通知取消の合成（`PostgresResultNotificationCancellation`）は全 source write の末尾で、同じ transaction 内に行う。確定・取消・試合削除に加え、マスター・開催削除時の古い下書き清掃も対象とする。
- 通知設定は API から共有 DB へ直接保存し、Summit への HTTP なしで完結させる。設定 adapter は共通 gate 取得後の最新 2 行を domain の変更判断へ渡し、両方の期待世代の一致を確認してから変更対象だけを書き込む。ON / OFF が変わる種類だけ世代を進め、OFF への変更と対象通知の未開始部分取消を一つの transaction へ合成する。競合時は両方とも現状のまま保つ。
- 通知 gate は source row の更新後に取得する。通知側は gate 取得後に source row lock を取らず、READ COMMITTED で commit 済み状態を読む。この順序で受付先行・対象変更先行の双方を収束させる。gate 取得後に追加の業務 write・外部 I/O を行わない。
- 取消は送達済み部分と開始済み部分の証跡を保ち、未開始部分だけを取消状態へ進める。開始済み送信が後から完了しても親を復帰させない。物理 schema・consumer 間の排他契約は対象 `momo-db` checkout の `docs/discord-notifications.md` を参照する。
- 分析通知の immutable 成果物は公開 lock 前の read-only / repeatable-read snapshot で必要 resource だけを上限付きで読む。最終 transaction で比較準備時の通知用入力基準・公開 revision・完了した要求元を確認し、業務 write 完了後の SAVEPOINT 内で gate を取得する。gate 取得と、設定・表示 metadata の一括 SELECT は別 statement とする。通常の準備エラーは SAVEPOINT を復旧して業務 commit を継続する。
- 通知用入力基準は初回・成果物参照・不明を区別し、API の新規作品作成だけが初回を明示する。公開制御は成功と同じ transaction で、通知設定や送信結果とは独立に基準を更新する。release は画面用 pointer を外してもこの基準を残し、履歴 cleanup は参照中の成果物を保持する。

## Contract Evidence

test の採用・維持・削除は [テスト・品質規約](test-rule.md#品質証拠の採用維持削除) に従う。DB contract を品質証拠に選んだ場合は、本節を production boundary と oracle の正本とし、変更に該当する項目を同じ単位で満たす。一項目ごとに新しい test case を要求する一覧ではない。

- 分析 release の algorithm / artifact schema / validation contract は不可分な tuple として扱う。momo-db revision、各 default、または baseline migration を変える場合は、fixture や cleanup が singleton を変更する前の fresh DB で exact consumer tuple との一致を確認し、promotion 済み DB の成功、legacy singleton からの promotion test、相対的な title inheritance、test 内で exact tuple を seed した repository test を代用にしない。
- 変更した query / repository を migration 適用済みの実 PostgreSQL で実行する。複数 table の write は statement / lock 順と保存後の関連 row を確認する。
- job lease、永続 fence counter、pointer、cleanup 競合は複数接続で stale owner と rollback を直接通す。
- publication contract を変更した場合は、staging の更新、published header / child の変更拒否、参照中 parent の削除拒否、未参照 parent の cascade cleanup を実 PostgreSQL で区別して検証する。
- 分析通知では実際の release promotion と公開成功を通し、画面用参照の切離し後の backfill 抑止、要求合流順に依存しない差分、OFF・送信失敗・公開失敗での入力基準を実 PostgreSQL で観測する。比較元の欠落を初回として送る test oracle を置かない。
- 通知取消では実際の確認・取消・削除 command と、source 更新後の rollback、通知 gate 待ちの commit 境界、部分配送証跡を実 PostgreSQL で観測する。
- 通知設定では cleanup が設定を初期化する前の migration seed、種類ごとの独立性、変更のない保存、両設定と通知取消の rollback、gate 待ち後の世代再確認を実 PostgreSQL で観測する。consumer との相互接続は実際の受付・送信開始 command を通し、取消 SQL を test へ写して代用しない。
- production が pooler / proxy を使う場合、直接 PostgreSQL への接続成功を wire 互換性の証拠にしない。session state を持つ consumer は、対応する接続方式で別接続の commit から機能 round trip を確認する。

## Migration / Deployment

- 後方互換な変更は migration 適用後に consumer を deploy する。
- 破壊的変更、NOT NULL / 型変更、大量 backfill、旧 schema 削除は、旧新 consumer の同時稼働期間を考慮して複数段階へ分け、deploy 順序、rollback、未移行データを実装前に決める。provider 固有の手順は `private/` に置く。
- 全 writer 停止を伴う非互換切替と切戻しは、対応する DB snapshot と consumer の組を承認時に確認する（[公開運用規約](ops/README.md)）。本番への migration 適用は、CI の使い捨て DB での検証とは別に本番の状態で確認する。
- 進行中の切替ごとの具体的な順序・混在禁止・切戻し先は [Transitional Contracts](#transitional-contracts) に置き、完了後に撤去する。

## Transitional Contracts

本節は移行中だけ有効な契約を置く。各項目は撤去条件を持ち、本番の DDL と全 consumer の切替完了を確認したら本節から削除する。削除の判断は古い名称ではなくこの確認に基づく。移行後も必要な契約は、恒久的に守る根拠を確認して該当章へ移す。

| 契約 | 内容 | 撤去条件 |
| --- | --- | --- |
| 通知用入力基準の導入 | 旧 writer を停止してから既存成果物を基準へ初期化し、対応する API・Worker へ切り替えて再開する。初期化後に基準を更新しない旧 Worker が公開すると、古い基準との差分を後続処理で再通知するため、この間の混在稼働を許容しない。切戻しも基準の整合性を保つ組合せで行う | 旧 Worker へ切り戻す可能性がなくなったことを確認する |
| validation contract 導入後の rollback floor | rollback floor は、新 column と exact attestation を理解しつつ未移行 artifact も検証して読める transitional consumer とし、戻し先はここまでとする（導入前 binary へは戻さない） | 未移行 artifact が残らないことと、導入前 binary へ戻す経路を廃止したことを確認する |

## Achievement Data

- 項目の固定 ID・条件・星・備考は、`.momo-db-ref` に固定した `momo-db` の `seeds/momotetsu2-achievements-v1.json` を使う。個人の達成情報は、manifest や migration ではなく、明示した TSV から consumer の初期化 command で投入する。定義 manifest の所有は `momo-db`、利用者の達成データの投入は consumer の初期化 command と分け、再投入後も利用者の訂正・取消を保つ（下記）。command の実行方法と入力は [実績の初期投入](tools/initial-achievement-import.md) を参照する。
- 既定は書き込まない dry-run とし、apply は同じ保存部品で定義・移行根拠・再計算 intent を一つの transaction に保存する。dry-run は後続の apply 時点の競合や集計完了を保証しない。
- 再実行時は、既存の同じ固定 ID の定義と移行根拠、および移行根拠の取消・訂正をそのまま保つ。下位達成の補完と自動達成は Worker だけが計算し、import command が保存する根拠は直接の移行根拠に限る。投入後は同じ世代の API・Worker で再計算結果を確認する。
