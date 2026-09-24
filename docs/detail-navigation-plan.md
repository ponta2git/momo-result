# MOM-21・MOM-23 詳細画面の前後移動 実施計画

対象: [MOM-21](https://linear.app/ponta/issue/MOM-21)、[MOM-23](https://linear.app/ponta/issue/MOM-23)。

2026-09-24、`develop`の`28ebc7ca`を基準に再構成した。利用者の合意、チケット、現行コード、共有schema、関連規約を根拠とする。初稿をAPI/DB、Webの状態・操作、検証・工程の3方向から敵対的にレビューし、その結果を反映した。**計画は作成済み、アプリ実装・実DB検証・E2E・本番反映は未実施**である。

## 1. 成果と変更範囲

開催詳細と試合結果で、一覧へ戻って探し直さず、行き先を確認して前後の記録へ移動できるようにする。移動後の本文・関連操作は現在の対象に揃え、元の一覧や比較条件へ戻れるようにする。

### 合意済みの利用者契約

| 対象 | 範囲・順序・戻り先 |
| --- | --- |
| 試合 | 開催・作品・シーズン・マップ・起点filterによらず全確定試合。`played_at → held_event_id → match_no_in_event → id`の昇順。「前」は直前、「後」は直後 |
| 開催 | 絞り込みによらず全開催。開催日時の昇順で「前」は古い側、「次」は新しい側。同日時は開催IDで安定化 |
| 画面内の戻り | 前後移動を始めたときの遷移元URLと表示条件を維持。filter、sort、page/cursor、比較のscope/view/selection、hashを落とさない |
| ブラウザ履歴 | 通常の履歴追加を使い、ブラウザの戻るは訪問した詳細をたどる |

欠番・削除済み試合・未確定下書きは試合の移動対象にしない。空開催も開催の移動対象には含む。試合の全体順では開催が連続するとは限らず、開催内番号だけを増減して移動先を推定しない。

対象は両詳細read、Webの前後導線・関連するcache/メモ保護、必要な要求文書と検証。比較の計算scope・algorithm・保存artifact、OCR処理、通知、export内容は変更しない。UI全体の再設計、全APIのvalidation基盤、全画面のfocus管理、先読み、pollingは追加しない。

恒久契約の正本は、開催を[開催一覧・詳細要求](requirements/held-event-detail.md)、試合を[基本要求](requirements/base.md#4-mvp画面)、メモを[試合メモ要求](requirements/match-note.md)、対戦順を[戦績比較要求](requirements/series-comparison.md#2-data--scope-invariants)とする。実装開始時に採用内容を各正本へ反映し、本書を恒久仕様の二重管理先にしない。

## 2. 敵対的レビューの結論

機能の目的と既存詳細readを拡張する方向は妥当。ただし初稿は、次の反例を解消せずに実装へ渡せる状態ではなかった。以下はコード・schemaからの静的な指摘であり、今回、実行時の再現を確認したという意味ではない。

| 優先度 | 初稿の不足と根拠 | 改訂で決めた対処 |
| --- | --- | --- |
| 高 | 列名のtupleだけでは比較と同順にならない。Workerはmicrosecond精度のUTC日時とRustの文字列順で正規化する。DBのIDは非空textでcollation指定なし、InMemoryの既存一覧は別順 | 元timestampの精度を保持し、IDの比較規則を明示。開催一覧との同日時順も同時に整合。3.1節 |
| 高 | 無効化はdataを消さない。既知404を再取得中のnoticeで判定すると、再mountで旧detailが復活する | 404をcache内の確定した不存在として保持し、新たな成功まで復活させない。再検証中の隣接操作も定義。3.3節 |
| 高 | 開催作成は一覧以外にもある。workspaceの`syncHeldEventCreatedCache`は一覧しか無効化しない | productionの全変更入口をmutation表へ割り当てる。削除対象の再fetch競合も除く。3.4節 |
| 高 | メモguardはdirtyしか見ず、送信中にも「破棄して移動」を許す。送信済みの保存はその操作では取り消せない | 保存・削除の結果待ちをdirtyと別に保護。新しい再取得が編集versionを変える問題も防ぐ。3.5節 |
| 中 | 所属開催へ現在試合のURLを逆向きに包む案は、開催→試合の既存linkと組み合わさり`returnTo`が増殖する | 新しい所属開催linkに逆向き`returnTo`を追加せず、前後移動の起点保持と分離。3.2節 |
| 高 | 必須型を先に追加して生成し、read実装を後工程にする手順はcompile依存を満たさない | domain/DTO・全constructor・read実装・正規生成を成立する先行工程にする。4節 |
| 高 | 同じrelease単位でも切戻し前の新Webは開いたまま残る。生成型も実wireを検証しない | navigation欠落/不正を端と区別し、本文と戻りを保つ。新Web＋旧APIも扱う。3.3・6節 |
| 中 | cache testのflagやmock成功では行き先を証明できず、E2Eは直積に広がり得る | 実QueryClient＋routerでhref/内容を観測し、E2Eは代表2経路に限定。5節 |

主な根拠は`Postgres*DetailReadModel.scala`、`series_analysis/input_repository.rs`、`analysis-core/src/model.rs`、`shared/api/queryOptions.ts`・`cacheInvalidation.ts`・`heldEventCache.ts`、`useMatchNoteEditor.ts`・`MatchWorkspaceNavigationGuard.tsx`、`apps/api/build.sbt`である。初稿の「DB変更は不要」「既存guardだけで安全」「無効化後は最新」「世代混在を防げる」を無条件な保証として引き継がない。

## 3. 実装契約

### 3.1 順序・read snapshot・wire

**既存の両詳細GETへ、最大2件の隣接identityを同梱する。** 同じ対象を読む別endpointとWeb側の世代照合を増やさず、現行のread-only / repeatable-readに現在対象・表示情報・隣接をまとめる。全件一覧、分析artifact、前後の詳細GETによるN+1で代用しない。

| read | 境界と取得順 | 前後1件の情報 |
| --- | --- | --- |
| 試合 | 生の`played_at`、開催ID、開催内番号、試合ID。小さい側を降順、大きい側を昇順に各1件 | `matchId`、`heldEventId`、`playedAt`、`heldAt`、`matchNoInEvent` |
| 開催 | 生の`start_at`と開催ID。小さい側を降順、大きい側を昇順に各1件 | `id`、`heldAt` |

- 試合のID比較はSQLの境界条件と`ORDER BY`双方で`COLLATE "C"`に揃える。InMemoryもUTF-8のbyte順を使う。timestampをepoch millisecondsや表示用文字列へ丸めて比較しない。既存exportの順序SQLは日時を丸めるため、そのまま流用しない。
- 開催も同じ明示的ID順へ揃える。新しい隣接だけを変更せず、`PostgresHeldEventListReadModel`、`PostgresHeldEventsRepository`の`listPage/listIds`と対応InMemoryを更新する。日時が異なる順は変えず、同日時のtie-breakだけをlocale非依存にする。この内部決定を開催要求へ記載する。
- 新APIの両詳細responseは`navigation`を必須とし、`previous`と`next`に対象identityまたは`Option`のabsenceを持たせる。双方なしでも`navigation`自体は返す。absenceのJSON表現は既存Tapir/Circeの派生codecに合わせ、生成OpenAPIと実HTTPの一致を証拠にする。欠落したenvelopeを両端と解釈しない。
- `MatchDetailResponse.from(record)`は隣接を知らないため廃止し、唯一のtest利用元を明示的な`MatchDetail`へ変更する。domain/DTOに未調査の空navigationをdefaultとして追加しない。確定・編集・開催作成のmutation応答やidempotency保存値へnavigationを足さない。
- InMemoryは既存一覧のlimit/順序を流用せず、対象集合を一度取得して現在対象と前後を選ぶ。開催の単一Ref読取りに必要な小さいadapter補助とbootstrap接続を追加する。複数repository全体がPostgres同等にatomicであるとは宣言しない。
- 隣接SQLが失敗すれば同じ詳細GET全体が失敗する。SQL例外を端や部分成功として握り潰さない。初回は詳細の取得失敗、再取得は3.3節の前回内容保持で扱う。旧wireのnavigation欠落による局所利用不可とは区別する。

**性能の実現可能性は先行工程で判定する。** pinned schemaには試合の`played_at`単列indexと開催内番号の一意性があるが、今回の全tupleと開催日時＋IDにそのまま合うindexは確認できなかった。各1件のresponseであることは、走査・sortの仕事量が一定という保証ではない。

隔離した合成fixtureで現行詳細と変更後詳細を比較する。既存の性能fixtureと要求に根拠を置く複数の総件数、同対戦日時への集中、先頭/中間/末尾について、実行計画・buffer・転送量・応答時間を調べ、選んだ規模の根拠を残す。一覧のpage sizeや一開催の上限を、全試合数の上限として扱わない。根拠のない数値閾値や本番性能保証は作らない。全量sort等が新たな支配的コストになる場合はqueryまたはindexを修正し、実DB証拠を得るまでAPI工程を完了にしない。

indexが必要なら`momo-db`所有の変更になる。編集・DB操作より前に`../momo-db/docs/development.md`を全文確認し、正規の生成・migration・検証・pin更新へ進む。文書がない、規約が矛盾する等の場合はそのDB変更だけを止める。今回の調査ではschemaの読み取りのみ行い、変更やDB操作は行っていない。

### 3.2 URLと戻り先

URLを戻り先の唯一の保存場所とし、既存`sanitizeReturnTo`と`withReturnTo`を使う。URLの安全性確認と行き先の業務分類は別に扱い、`startsWith("/matches")`だけで試合一覧と試合詳細を混同しない。

| 操作・入口 | 遷移先と戻りの扱い |
| --- | --- |
| 試合/開催の前後link | 次の詳細に、受け取った安全な起点`returnTo`をそのまま付ける。現在詳細を新たに包まない |
| 起点のない直リンク | 起点を作らない。試合は表示中試合の所属開催、開催は開催履歴を既定の戻り先にする |
| 試合から編集・出力・比較 | 現在詳細の完全URLを渡す既存の子操作契約を保つ。比較scopeとfocusMatchId、編集/出力のIDは移動先試合から生成する |
| 現在試合の所属開催を見る | 所属開催の通常URLへ進み、新しい逆向き`returnTo`を付けない。browser backで元試合へ復帰できる。起点が同じ開催を指す場合は起点の完全URLを再利用し、同じ開催へのlinkを重複させない |
| 不正・自己参照の戻り先 | 外部/不正URLは既存sanitizeで拒否。現在resourceそのものを指す戻り先は使わず、安全な既定導線と短い理由を示す |
| 移動先または起点の404 | 起点へ戻るlinkに加え、試合一覧/開催履歴への確実なescapeを用意。起点の実在確認のための先行GETは追加しない |

開催A起点で開催Bの試合を表示しているとき、戻りlabelは「元の開催へ戻る」とする。「この開催へ戻る」と呼ばない。起点別に試合一覧・開催・比較を分類し、分類できない安全な内部URLは中立な戻り文言にする。ready/取得失敗/404で同じ判定を使う。

所属開催への新linkを逆向きに包まないことで、開催→試合→所属開催→試合の反復で今回新たに作る循環を防ぐ。既存の編集・出力・比較まで含む汎用履歴管理の作り直しは行わない。正当なquery/hashを保持し、`returnTo`の一括flattenで表示条件を失わせない。

### 3.3 読取り状態とcacheの形

取得状態を`useRetryNotice`の表示記憶だけで判定しない。既存`seriesAnalysisMatchContextState.ts`と同じ方針で、両詳細queryは正常読取と正規Problem Detailsの`404 / NOT_FOUND`を区別するread resultを保存する。確定404では以前の本文を含む成功値を置換し、その後の通信失敗で旧本文を復活させない。不明な404を削除確定へ変換しない。

API facadeの小さい境界checkが新しいnavigation envelopeとidentityを確認する。正常な端、envelope欠落、不正なidentity・自己リンクを区別する。navigationが欠落/不正でも、読めている既存本文まで利用不可にはしない。全responseの新しいvalidator基盤を作らず、今回追加する契約の保証範囲を明示する。

cache内の型は「foundの本文＋判定済みnavigation状態」または「notFound」とし、URL・日本語label・focusなどのViewModelを入れない。raw responseとはruntime shapeが変わるため、query keyにshapeを区別するsegmentを加える。detailを共有する**試合編集workspaceとprefetchも同じfactory・型へ移行**する。workspaceはunwrapだけでなく`query.error`依存の404判定も更新する。identity/summaryの別shape、resource単位のeviction、root無効化のprefix/exact用途も確認する。

| 状態 | 本文・メモ | 前後導線・回復 |
| --- | --- | --- |
| 現在IDのdataなし | 構造的loading、または初回error | 行き先を推測しない。失敗時は再取得と戻り |
| 現在IDの成功snapshot、取得中でない | 現在の結果を表示 | 正常identityだけをlinkにし、正常absenceを端として示す |
| 同じIDを再検証中/通信再開待ち | 前回内容と未保存入力を保つ | 前回の行き先を最新と扱わず前後操作を一時停止。局所的な更新状態を示す |
| 同じIDの再取得が一時失敗 | 前回内容と未保存入力を保つ | 前後情報の再確認失敗と再試行を示す。失敗を「前後なし」にしない |
| 404確定、その後の再訪・再試行 | 結果・編集・隣接を復活させない。未保存メモの扱いは3.5節の独立した退避設計に従う | 不存在と安全な戻り。同じIDの成功読取だけで復帰 |
| 本文は読めるがnavigation欠落/不正 | 本文と通常の戻りを残す | 前後機能の利用不可と局所再取得。欠落が続く場合は画面再読込を案内。端とは表示しない |
| 別IDへ移動 | 別対象の本文をplaceholderとして使わない | 移動先のready/errorを表示。前対象の分析・linkを混入させない |

ページ再読込を提供する場合も未保存メモの保護を通す。時限staleだけで表示/linkを消したり、自動取得を起動したりしない。既存のfresh cacheを再利用する間は別端末の変更を直ちに検出できない。次の明示更新・mutation後の再検証・通常の再訪取得で反映する範囲を保証し、常時最新とは表現しない。

### 3.4 mutationによる隣接の更新

無効化のflagを立てるだけで完了とはしない。既存の関連一覧・分析・summaryの整合を維持した上で、次の入口を覆う。再訪して再検証する間は3.3節に従う。

| production入口 | 隣接に必要な処理 |
| --- | --- |
| 試合確定 | `invalidateAfterMatchConfirmed`から試合detail群も無効化 |
| 試合編集 | `invalidateAfterMatchUpdated`から試合detail群を無効化。日時/開催/番号の変更は他開催の隣接にも影響する |
| 試合削除 | 削除対象を隣接更新のrefetchから除外し、他の試合detail群を無効化。既存の遷移→対象evictを守り、進行中GETが削除対象を復活させない |
| 開催一覧からの作成 | 既存の開催無効化を維持。不完全な`{...event, matches:[], drafts:[]}`のdetail seedを撤去 |
| 試合workspaceからの開催作成 | `syncHeldEventCreatedCache`に開催detail群の無効化を追加。完全なsummaryのseedは維持 |
| 開催削除 | 実際の一覧削除経路で対象のcancel/evictと他の開催detailの無効化を接続。未使用helperのtestだけで保証しない |
| メモのみの保存/削除 | 当該試合detail・一覧・開催projectionの既存整合を保つ。全試合の隣接や分析を無効化する理由にしない |

全inactive detailの強制再取得や隣接依存registryは作らない。削除対象の除外はquery keyのprefixとresource IDで限定し、QueryClient全体のresetで未保存状態や無関係な画面を巻き込まない。

### 3.5 メモの保護と保存後の表示

既存guardへのlink接続だけでは不十分なため、前後移動と新しい再取得が通る範囲で次を実装する。

- 未保存・未送信なら「編集を続ける／破棄して移動」。メモにOCR確認の破棄文言を流用しない。キャンセル時は本文とfocusを保つ。
- 保存/削除の応答待ちはdirtyと別に扱い、アプリ内移動とbrowser backを処理結果が分かるまで保護する。「破棄」で送信済み操作を取り消せるとは説明しない。reload/タブ終了はブラウザが許す警告範囲とし、送信の取消保証はしない。
- 保存成功が確定した後の表示再取得は別段階とし、その待機だけで移動を禁止し続けない。失敗時は未保存入力と再試行intentを維持する。
- 編集開始時の本文/versionを保持し、再取得でpropsが変わってもdirty比較と保存のexpectedVersionを勝手に更新しない。明示的に競合を解決するときだけ基準を更新する。最新読取に失敗したとき、cacheの古いdataを「最新版」として競合表示へ渡さない。
- 保存成功responseのversionと確定した正規化本文/削除を当該cacheへ反映してから再取得する。responseには更新者・更新日時がないため、古い来歴を消し、再取得まで確認中として表示する。versionはopaqueな値として等値判定だけに使い、数値や文字列の大小で新旧を決めない。送信時の基準versionから別versionへ進んだcacheや確定404を遅い応答で上書きせず、競合する取得をcancelして成功後の再検証へ揃える。再取得失敗は保存失敗と分けて示す。
- 404時の入力保全は既存のready表示では実現しないため、編集状態の寿命を当該matchIdの画面に持たせ、ready/terminalの描画分岐から分離する。不在の結果を再表示せず、ローカル未保存本文だけをコピー・明示破棄できる退避表示と移動guardを残す。メモ以外のworkspace状態機械全体は再設計しない。

### 3.6 表示と操作

両画面とも上部の現在地・戻り導線に隣接する一か所へ配置する。前後は「前の試合／後の試合」「前の開催／次の開催」とし、存在しない側は理由のある非link表示にする。矢印だけや`#`へのlinkにしない。

試合は対戦日時と開催内番号を主表示とし、開催日時が異なる場合は所属開催の日時も補う。開催は年・時刻を含む日時を使う。表示精度の丸めで重なる場合は必要な精度を補い、完全同日時では相対順を示す。内部IDや比較scope内の「第N戦」を、新しい通算試合番号として表示しない。

shared UIが所有するのは名前付きnavigation、2方向のlink/非link、keyboard/focus、hit targetと狭幅配置まで。業務語彙・URL・API・cacheはfeature/API側に残す。既存`LinkButton`のdisabled表示は要素を置換するため、再取得時のfocusを失わない接続を代表ブラウザで確認し、必要な小さい補助だけを追加する。

遷移後focusは今回の前後linkによる移動に限る。originとは別の一時的な移動intentで識別し、移動先のreadyまたはterminal見出しへ一度だけ移す。見出しと日時の対応を読み上げ可能にし、別開催の同じ「第1試合」も区別する。取得中に利用者が他の操作へ移った場合はfocusを奪わず、同対象refetchで再実行しない。通常のbrowser backや他画面へ全体適用しない。

## 4. 成立する工程と並列作業

| 工程 | 作業と所有者 | 終了条件・次への依存 |
| --- | --- | --- |
| A. 契約整理 | 統合担当が合意を要求正本へ反映。wire、read-result、状態表、共有UI入出力を確定 | 確認済み仕様を再質問せず、3節と型・検証の対応が決まる |
| B. APIの成立 | API担当がquery/domain/DTO、Postgres/InMemory、constructor・bootstrap、開催同日時順を一括更新。性能と必要なDB変更を判断 | 本体compile、代表HTTP・実DB証拠。仮の空navigationで通さない |
| C. 正規生成と共通接続 | 統合担当がBからTapir→OpenAPI→Web型を生成。read-result/key、shared UI、cache/returnTo、共通MSWを整合 | 型・factory契約をWeb担当へ渡せる。生成物は手編集しない |
| D1. 開催Web | 開催担当がPage/PageModel/status、一覧create/delete、対応factoryを更新 | 開催の連続移動と戻り、端・失敗のcomponent証拠 |
| D2. 試合Web | 試合担当がPage/PageModel/identity、メモeditor/guard、編集workspace・prefetchのread-result接続、対応factoryを更新 | 越境、メモ保護、現在試合の各href、404保持のcomponent証拠 |
| D3. 共通統合 | 統合担当がworkspace開催作成、mutation/cache接続、共有test・MSW、文書を調整 | 全入口のmutation表とcache実操作証拠が揃う |
| E. 最終検証 | 統合担当が5節のgate・Playwright MCP・visual reviewを実施 | 受入条件と必要gateを満たす。未実行は未検証として記録 |

Bの間にWebのURL/状態設計と既存証拠の整理は並列で進められる。正式な生成型を必要とするD1/D2/D3はCの後に並列化する。`build.sbt`ではOpenAPI生成が本体compileへ依存するため、必須型だけを追加してBを飛ばさない。

APIのschema/生成物、Webのquery/facade/cache、shared UI、共通MSWは統合担当を窓口とし、feature担当が同時編集しない。API担当の成果から統合担当が生成する。feature別factoryは各担当が所有する。独立checkは並列化し、同一build出力・DB・fixtureを共有する実行だけを隔離または直列化する。

追加監査先は`useMatchWorkspaceQueries.ts`・`useMatchEditPrefetch.ts`、`shared/api/heldEventCache.ts`、`useWorkspaceHeldEventCreation.ts`、`test/msw/matchHandlers.ts`、E2Eのdetail応答overrideである。最初に参照された両Pageだけを変更対象とみなさない。

## 5. 受入証拠とgate

| ID | 守る結果 | 境界・主oracle |
| --- | --- | --- |
| V1 | 全試合・全開催の直前/直後が正しい | 実PostgreSQLの期待ID・日時・番号。先頭/中間/末尾/1件、欠番・削除・空開催、開催/作品越境、日時と番号の逆転を小さいfixtureで確認 |
| V2 | 比較・一覧と同じ安定順、十分なquery cost | submillisecond差、同時刻ID、locale差が出るID。変更queryと開催一覧の同順、InMemoryとの代表的な順序契約の一致。性能は3.1節の隔離実行計画・比較観測 |
| V3 | 正常な端と異常を混同しない | HTTP/decoderで両側・片側・双方なし、navigation欠落/不正、現在対象404。HTTPへV1の全fixtureを複製しない |
| V4 | 現在対象・戻り先・関連操作が一致する | router付きcomponentでA→B→C。結果/メモ、比較scope/focus、編集/export/記録開始のhref。filter/cursor/hash、直リンク、自己参照、起点404、所属開催との反復をpartition化 |
| V5 | 旧data/削除済み対象/未再検証linkが復活しない | 実QueryClient＋data router＋MSW。成功→404→別対象→再訪→遅延/500→成功、およびinvalidate済みinactive detailへの再訪。旧hrefなしと復帰条件を観測 |
| V6 | 全mutation入口で次の行き先が更新される | 実QueryClientで確定・日時等の編集・削除、一覧/workspaceの開催作成を通す。再訪後の具体的href・削除対象の非復活を観測。isInvalidated/call countだけで済ませない |
| V7 | メモを失わず、送信済み操作を破棄と誤認させない | data router＋遅延mutation。dirtyのキャンセル/破棄、保存/削除中のlinkとbrowser back、成功後移動、失敗再試行、編集中refetch/409、保存成功＋GET失敗、404時の未保存本文退避 |
| V8 | 実画面で前後移動と戻りが使える | Playwright MCPの下記2経路。URL・結果・メモ・比較focus・戻り先が主oracle |
| V9 | 行き先と現在地が読め、操作できる | 同じ代表画面で広幅/最小狭幅、Tab/Enter、focus、44px hit target、同日時/同番号、端、errorを目視。横overflowや再取得によるfocus消失を確認 |

Playwrightは次の2本を代表経路とする。起点3種×端×端末の直積を作らず、細かなpartitionはV1〜V7で固定する。

1. 開催履歴の2ページ目→開催詳細→前/次を連続移動→元ページへ戻る。移動先の試合・出力/記録開始linkが現在開催を向くことを確認する。
2. 条件付き試合一覧または比較→試合結果→別開催・別比較scopeの試合→移動先の比較→試合結果→元の起点へ戻る。未保存/保存待ちの保護とkeyboardを代表接続として含める。

export内容や分析値の計算自体は変更しないため、それらの既存証拠を再利用する。新しいhref/対象IDと、既存downloadやWorker計算の再検証を混同しない。実API/DBとの接続をmockされたE2Eの成功だけで確認済みにしない。

必須gateは[Change Gates](dev-rule.md#4-change-gates)と現行CIの実行単位に従う。

- API: `apps/api`で`sbt apiQuality`、通常`test`またはPRの`apiCoverage`の一方、変更SQLを通す`apiDbQuality`。生成は`sbt apiOpenApi`。
- Web: `pnpm --filter web generate:api`、`format:check`、`lint`、`contract:check`、`typecheck`、通常`test:run`またはPRの`test:coverage`の一方、`build`。
- UI: 隔離DB/API/WebでPlaywright MCP。visual reviewもPlaywright MCPまたはcontrol-chromeを使用し、in-app-browserで代用しない。
- 文書: `git diff --check`、`pnpm public:safety:check`。

上記は現行CIの他の必須jobを省く指示ではない。同じtest集合の通常実行とcoverageを重複させず、coverage集計値とtest成否を分けて報告する。既存testの無効化mock、DOM順/子要素数のassertionを機械的に増やさない。[テスト規約](test-rule.md)と教訓L1/L2/L3/L5/L7に従い、変更経路と利用者結果を直接観測する。

## 6. 互換性・完了・公開範囲

| 組合せ | 確認する挙動 |
| --- | --- |
| 旧Web＋新API | 追加fieldを無視でき、既存詳細と通常操作が動く |
| 新Web＋新API | 前後導線を含むV1〜V9を満たす |
| 開いたままの新Web＋旧API | navigation欠落を端や例外による画面全損にせず、本文・戻りと再読込による回復を残す。新機能の継続利用は保証しない |

API/Webの対応と、DB変更が生じた場合の適用順をrelease時に確認する。ブラウザに残る旧世代/新世代まで同一release単位で自動的に排除できるとは扱わない。具体的な配備・rollback手順やprovider構成は複製せず、[公開運用規約](ops/README.md)と承認された運用手順に従う。

通常実装PRは`develop`向けの一つの単位とし、本文に`Fixes MOM-21`と`Fixes MOM-23`を記載する。必要なmomo-db変更は所有repositoryで別途扱い、依存revisionと導入条件を揃える。release PRは[Git規約](dev-rule.md#8-git)どおり対象PR・両issue・利用者向けRelease notesを記載する。

実装完了は、要求正本・実装・生成物が一致し、V1〜V9と必要gateの証拠が揃い、重要な未検証境界を明記した時点とする。再実行は結果を無効にする変更・失敗・具体的な未解決事項の影響範囲に限る。計画作成、実装完了、release完了を別に扱う。

## 7. 今回の成果と未検証事項

- 初稿を全面再構成し、合意済みの範囲・順序・起点保持を維持した。追加の利用者判断を要する仕様の不明点はない。
- 現行API/Web、CI/生成依存、pinned revisionと一致するmomo-db schemaを読み取り確認した。DB操作・schema変更は行っていない。
- Context7の公式資料で[query invalidation](https://github.com/tanstack/query/blob/main/docs/framework/react/guides/query-invalidation.md)、[query key](https://github.com/tanstack/query/blob/main/docs/framework/react/guides/query-keys.md)、[Link](https://reactrouter.com/7.18.2/api/components/Link)と照合した。
- 今回実行するのはdocs-only gate。query性能、index要否、実API応答、実ブラウザのfocus/読み上げ、変更後の機能と互換動作は実装工程で検証する。調査だけで通過扱いにしない。
- 文書gateは`git diff --check`と`pnpm public:safety:check`が通過。新規ファイルの本書も`git diff --no-index --check /dev/null docs/detail-navigation-plan.md`で空白エラーなしを確認した。
