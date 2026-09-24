# MOM-22 オーナー比較の選択試合ハイライト実施計画・結果

対象: [MOM-22](https://linear.app/ponta/issue/MOM-22)「試合結果から戦績比較へ移動した際にオーナー比較もハイライトする」。
調査基準: 2026-09-24、`develop` の `a32e0cc9`。チケット本文、関連MOM-3、既存コード・schema・規約を確認した。本書は合意済みの表示範囲とレビュー結果を統合した計画と実施記録である。同日に実装・ローカル検証を完了した。2〜6節は調査時点の事実と採用計画を示し、実施結果・保証範囲は8節に記録する。本番への反映は別工程。

## 1. 目的・範囲・受入条件

試合結果の「前後の戦績を見る」から戦績比較へ移動した利用者が、「条件別」のオーナー比較でも、選択試合が含まれる集計列を識別できるようにする。

利用者との合意は、**選択試合のオーナーに対応する列見出しと4人分のセルを、全7指標で強調する**こと。列見出しに「この試合のオーナー」と表示する。表の数値は引き続きそのオーナーの試合全体の集計値とし、選択試合単独の値に置き換えない。オーナー本人の行だけを強調する仕様ではない。

| ID | 受入条件 |
| --- | --- |
| A1 | 有効な選択試合に対応する1列の見出しと4人分のセルを示す。輪郭等と可視の「この試合のオーナー」を併用し、色だけに依存しない |
| A2 | 全7指標で同じ列を示し、既存の数値・分母・戦数・参考値・対象なしの意味を維持する。順位分布内の個々の順位には追加マーカーを付けない |
| A3 | 試合・scope・artifactの変更、選択解除、取得失敗・無効化で、選択試合表示と各指標の強調が同じ表示状態に従う。対応を確認できない列を推測して強調しない |
| A4 | 集計条件、初期の切り口、既存指標の強調、試合結果への戻り先・browser backを維持する。同じAPIを使う試合結果画面の通算平均順位・前後差・注目点も維持する |
| A5 | 広幅・狭幅、固定見出し、行hover、横scroll、keyboard操作で列と値を読める。指標変更で操作中のfocusや表のscroll位置を失わない |
| A6 | API・生成契約・Web両画面・query cacheを一体で更新し、旧応答を新形式として利用しない。対応API/Webの切替・rollback条件を明示する |

対象はAPIのmatch-context表示情報、Webのcontext利用境界、オーナー表と共通表の列強調、必要な契約文書・検証。オーナーfilter、並び替え、新しいセル操作、自動scroll、pollingは追加しない。DB schema・migration、Worker、分析algorithm、保存artifactのschema / validation contractは変更せず、本件のための全件再計算・promotionも行わない。

判断の正本は[オーナー比較要求](requirements/series-owner-comparison.md)、[分析横断要求](requirements/series-analysis-batch.md)、[アーキテクチャ](architecture.md)、[UI規約](ui-rule.md)。実装時に要求の変更は各正本へ反映し、本書を別の恒久契約にしない。

## 2. 現行実装と採用方式

### 確認した事実

| 境界 | 現行の事実と設計への影響 |
| --- | --- |
| 表示 | `SeriesAnalysisContent` は表示bundleの `match.focusedItemIds` を各viewへ渡すが、`SeriesAnalysisContextView` からowner表へ選択情報を渡していない |
| 保存・HTTP | match contextにowner IDはなく、ownerセルにも `itemId` がない。既存の `focusedItemIds` からowner列を特定できない |
| APIの読取 | `PostgresSeriesAnalysisChunkOps.matchContextCio` は同じSELECTで現在の試合所属・`analysis_revision` と指定artifactの `source_match_revision` を読み、不一致を除外する |
| 分析・訂正 | Workerはownerとrevisionを同じ入力snapshotから読み、owner別集計とmatch contextを作る。`PostgresMatchesRepository.update` はowner変更とrevision加算を同じUPDATEで行う |
| 共通consumer | 比較画面に加え、`useMatchFeatureAnalysis` を使う試合結果画面も同じmatch-context API / query factoryを利用する |
| 表示状態 | bundleはartifact・scope・試合ID・includedを照合し、切替中に旧bundleを保護して表示する。成功済みdataと再取得errorは別に扱われる |
| 共通表 | `DataTable` は行・列見出しと固定見出し、名前付きscroll領域を持つが、列強調のopt-inはない |

成功済みcontextが残ると、再取得で404/410を受けてもdataから表示を解決し得る経路を静的に確認した。これは実行時の不具合を再現済みという意味ではない。4節の状態契約を実装初期の回帰証拠で確かめ、必要な修正を共通境界に入れる。

### 採用する方式と整合性の根拠

**revisionを検査する既存SELECTに `m.owner_member_id` を追加し、同じread snapshotで得たownerをHTTP応答へ付加する。** `included` の `match.ownerMemberId` は必須とし、`excluded` は従来どおり `match: null` とする。

この方式は、Workerの `input_repository.rs` がownerとrevisionを同じ入力snapshotで取得し、`compute/owner.rs` がそのownerで集計し、`compute/match_context.rs` が同じrevisionを保存することを前提とする。通常の訂正でownerとrevisionが同時に更新されるため、APIの読取時にrevisionが一致すれば、取得したownerは分析時の所属に対応する。

保証はその読取時点の整合性まで。応答後の別端末による訂正は、既存のmutation後のreset、明示更新、再訪時の取得方針で扱う。revisionを進めないDB直接修正を通常の更新経路として扱わず、新しい監視処理も追加しない。

実装では次の境界を守る。

- `ChunkMaterial` 内で、対象試合のsource revisionとownerを一つの型付き値として運ぶ。独立したoptional引数に分離しない。別snapshotで可変表示名を取得する `displayMetadata` へowner取得を足さない。
- 保存artifactのdecode・checksum検証後にHTTP専用情報を付加する。保存schemaへfieldを混入させず、既存のpermit・DB接続解放と、付加後のnode数・response byte上限を維持する。
- owner IDの構造を既存ID schemaに揃え、decode済み試合の参加者に属することを上限付きで確認する。不正値を補完せず、集計値やcross-resourceの意味をAPIで再計算しない。
- 数値・順序・`focusedItemIds` は保存値を維持する。表示名は表示中のaggregateのowner列から得る。

| 検討案 | 判断 |
| --- | --- |
| revision検査と同じSELECTでownerを取得 | 採用。既存の整合性境界を利用でき、追加のDB往復・保存形式変更が不要 |
| WorkerにownerセルIDとfocusedItemIdsを追加 | 不採用。今回の列対応に対して、保存形式・分析契約・再計算への変更が過大 |
| Webが試合詳細を別取得する、URLやnavigation stateでownerを運ぶ | 不採用。別世代との照合やcache管理が増え、訂正時に新旧の情報が混在する |

## 3. API・HTTP・cacheの契約

### HTTP v3への更新

現行の生成validatorで、既存fixtureのHTTP projectionは受理され、そこへ `match.ownerMemberId` を追加すると `/match` の `additionalProperties` 違反で拒否されることを実行確認した。field追加は現行Webと互換ではない。

新しい応答形式を明示する設計判断として、`/api/analytics/series-comparison/v2/match-context` をv3へ更新する。URL変更自体が互換性を解決するわけではなく、対応API/Webの切替が必要である。恒久的なv2 endpointや旧形式decoderの併存は行わない。

| 更新するもの | 維持するもの |
| --- | --- |
| endpoint、`HttpOperation.GetSeriesAnalysisMatchContext`、HTTP schemaの `$id` | versionを含まないcomponent名・resource kind |
| Web facadeのV2型名、API wrapper、両画面のconsumer、MSW / HTTP fixture | 保存chunkの `schemaVersion: 1`、artifact schema、validation contract、algorithm |
| Tapir由来のOpenAPI、Web生成型・validator | 保存fixtureと既存artifact。生成file名は既存generatorに従う |

### query keyとconsumerの移行

match-contextのquery keyにHTTP shapeを区別するsegmentを加える。既存 `seriesAnalysisKeys` の `["series-analysis", "artifact", "v3", "match-context"]` はHTTP versionとは別のnamespaceなので、全resourceのrootを改名しない。

`matchContextRoot()` のprefix resetを維持し、paramsは末尾に保つ。`cacheInvalidation` が `queryKey.at(-1)` を参照する前提を壊さない。比較・試合結果の両画面で、取得、失効回復、明示更新、訂正・削除後のresetに同じfactoryを使う。`ownerMetric` はscopeや取得keyへ加えず、指標変更だけで通信・再計算しない。

比較画面は既存bundleからownerを導出する。試合結果側は `useMatchFeatureAnalysis`、`matchPerformanceContextFromArtifact`、`matchDetailViewModel` と関連型を更新し、通算平均順位・前後差・注目点の回帰を確かめる。型名の置換だけで移行完了とはしない。

## 4. 表示と状態遷移の契約

### 表示情報の流れと共通表

`SeriesAnalysisContent` → `SeriesAnalysisContextView` → `SeriesAnalysisOwnerComparison` に、`focusedOwnerMemberId?: string` 相当の狭い入力を渡す。既存の `focusedItemIds` と同じ表示bundleのcontextから導出し、owner表に独立したstate、URL読取、QueryClient参照を持たせない。

feature側で「owner IDに一致する列が一つ」「対象戦数が正」「表示する4人すべての対応セルが存在」を確認する。成立した1列だけを強調し、成立しなければ列全体を強調しない。この確認は表示先の存在確認に限り、集計値の再計算はしない。

共通 `DataTableColumn` に既定falseの `highlighted?: boolean` 相当を追加する。共通表は同じcolumn keyの見出し・body cellを一体で描画し、featureが対象列と文言を決める。非対話的な対応表示に限定し、汎用style注入、別wrapper、matrixの再設計、選択gridの意味を加えない。

- 既存action / selection tokenの輪郭または内側の線と、見出しの可視文字「この試合のオーナー」を併用する。線で列幅・行高を変えず、外向きringの重なりやscroll領域での切断を避ける。
- 通常列、メンバーの識別、順位色、品質表示を維持する。固定見出し・行hover・長い順位分布でも強調が消えたり別列へ広がったりしない。
- 「この試合」は共通の「選択中の試合」表示に対応させ、試合説明を重複追加しない。native tableの行・列見出しを保ち、全セルの内容を同じ長文aria-labelで置き換えない。新しいtab stopやクリック可能に見える装飾を加えない。
- 指標変更で表をremountせず、selectのfocusとscroll位置を維持する。実screen readerの読み上げは、DOM検証だけで保証したと扱わない。

### 他指標と揃える意味

| 指標 | 選択試合との対応 | オーナー比較との整合 |
| --- | --- | --- |
| 番手比較 | 各プレーヤーの番手セルをitem IDで示す | 同じcontext・強調tokenを使い、4人の対応を示す |
| 順位分布・順位遷移 | 試合の順位・遷移が属する集計区分を示す | 強調しても値は集計値のまま |
| 売り場×目的地 | 各プレーヤーの該当区分を輪郭と文字で示す | 色だけに依存せず、比較対象を変えない |
| 推移・試合一覧 | 表示範囲内の該当する点・項目を示す | 表示先がない場合は対応を捏造しない |
| オーナー比較 | 全4人に共通する試合属性に対応した1列を示す | 同じbundleで切替・解除し、順位分布内部の順位は追加強調しない |

共通にするのは選択試合の正本、対応の一意性、状態遷移、強調の意味。owner列用に架空のitem IDを作らず、番手matrixの表現をそのまま移植しない。[既存仕様](series-owner-comparison-spec.md)の「選択試合のringは持ち込まない」は順位分布内の表現を指すため、列強調との違いを明記し、その制約は維持する。

### 状態ごとの表示結果

| 状態 | 期待結果 |
| --- | --- |
| artifact・scope・試合が一致しincluded、表示先も成立 | 対応する見出し＋4セルを強調 |
| 指標・切り口を変更 | 選択試合を維持し、条件別へ戻ったときも同じowner列を示す |
| 試合AからBへ変更しBのcontextが未取得 | 既存の操作保護中はAの選択表示・表・全指標の強調を一体で保持してよい。Bの対応が揃ったcommitで一体に切り替える |
| 選択解除・scope変更 | deferred描画中の保護された旧bundleは許容する。新しい選択なしbundleのcommit後は全指標で強調なし。ownerだけ早く消す・遅く残す動作にしない |
| artifact・scopeの取得切替中 | 旧bundleを表示する場合も、その選択試合・表・強調を一体で保護し、新旧を混ぜない |
| 初回または別試合のcontext取得失敗、対応する成功済みcontextなし | 表示可能なaggregateはcontextなしで表示し、全指標を強調しない。既存の失敗・再試行表示へ収束 |
| 同じartifact・scope・試合の再取得で一時的な通信・サーバーエラー | 有効性を否定されていない成功済みsnapshotを一体で保持し、更新失敗を示す。最新性を確認済みとは扱わない |
| 現在のcontext requestで試合不存在404またはartifact失効410を確定 | cached contextを有効と扱わず、共通境界で選択試合表示と全指標の強調を外す。aggregateの表示とbounded recoveryは既存契約に従う |
| revision不一致、scope外、artifact未収録 | 既存の除外理由と解除動作を使い、ownerも強調しない |
| owner不明、該当列なし、0戦、必要セル欠損 | 別列へ補完せず、ownerの強調なし。不正wireは既存decoderで拒否 |

一時失敗と確定した無効化を区別する。判断材料は現在のqueryに対応する正規化済みのProblem Details / exclusionとし、別keyの古いerrorを混ぜない。無効化されたcontextは、次のrefetch中も新しい成功応答が届くまで復活させない。

実装初期に「成功→404/410」「成功→一時失敗」「A→Bの遅延応答」を区別する回帰証拠を用意する。修正は `useSeriesAnalysisResource` / bundle境界と試合結果側のcontext利用判定へ反映し、owner独自guardや無関係なquery基盤の改修に広げない。試合結果の保存済み本体は維持し、無効なcontext由来の派生表示を外す。

## 5. 実施手順と変更箇所

| 順序 | 実施内容・主な変更先 | 次へ進む条件 |
| --- | --- | --- |
| 1. 要求・契約 | owner要求・仕様にA1〜A5と状態条件を反映。分析横断要求のRead APIとarchitectureのwire / 表示projectionにrevision整合とHTTP世代を記載 | 表示契約はowner要求へ集約し、既存の順位分布制約と矛盾がない |
| 2. API・生成 | `PostgresSeriesAnalysisChunkOps` のSQL・型、Repositoryの受渡し、`PostgresSeriesAnalysisChunkCodec.includedContext`、`SeriesAnalysisResponseSchemas`、endpointを変更。正規生成でOpenAPI・Web型・validatorを更新 | 同じsnapshotのownerのみ返り、included / excluded、既存上限、保存形式維持を直接確認 |
| 3. consumer・状態 | API wrapper、facade、query key、MSW / fixtureと両画面を移行。4節の共通context利用判定とreset / recoveryを確認・修正 | 選択表示と既存指標が一致し、無効なcached contextが復活しない |
| 4. 表の接続 | `DataTable` に任意列強調を追加し、bundle→条件別→owner表へ接続。全7指標で同じ対応判定を使用 | A1・A2を満たし、通常consumerと既存操作を維持 |
| 5. 検証・修正 | 6節の直接証拠、必須gate、Playwright MCPによる主要導線・見た目の確認。失敗箇所とその影響範囲を修正・再検証 | A1〜A6の証拠と、重要な未検証境界が明確 |
| 6. 引渡し | 実施結果を本書へ記録し、`develop` 向け通常PRに `Fixes MOM-22` を記載。対応API/Webを同じrelease単位にまとめる | 7節の完了・切替条件を満たす |

生成物を手編集しない。現行in-memory repositoryは対象chunkを返さないため、移行のためだけに架空のowner生成を加えない。ライブラリ固有のAPI・設定を実装する際はAGENTS.mdに従いContext7で現行資料を確認する。

## 6. 検証計画と必須gate

証拠の選択は[テスト・品質規約](test-rule.md)、必須gateと終了条件は[Change Gates](dev-rule.md#4-change-gates)に従う。[教訓](post-mortem/lessons.md)の実DB・実操作、bundle / cache切替、wireの意味と生成物の同期に関する項目を反映する。

| 境界・実施先 | 証明する結果 | 受入条件 |
| --- | --- | --- |
| `PostgresSeriesAnalysisRepositorySpec`＋実PostgreSQL | revision一致時に正しいowner。productionの `PostgresMatchesRepository.update` でowner A→Bに訂正すると旧artifactはexcluded・ownerなし。欠落・scope外・未収録・失効も維持。revisionだけの直接UPDATEを訂正経路の証拠にしない | A3・A6 |
| Codec / schema / HTTP契約test | includedに必須owner、excludedはmatchなし。生成validatorと実応答が一致し、owner構造・参加者制約・付加後のnode / byte上限が有効。保存payload、従来値・item ID列は不変 | A2・A6 |
| `queryKeys` / `seriesAnalysisQueryOptions` / mutation接続test | 新旧shapeを分離し、末尾paramsとprefix resetを維持。両画面の取得・回復・明示更新・訂正 / 削除後resetが新keyへ届く。指標変更で通信しない | A3・A4・A6 |
| `SeriesAnalysisOwnerComparison.test.tsx` | 全7指標で正しい見出しと4セル。同ownerの別試合・別ownerの試合・解除・不明・0戦・セル欠損を区別。数値・件数・品質表示を維持 | A1・A2・A3 |
| `DataTable` component test | opt-inの同列見出し・セルにだけ作用し、通常consumerとnativeの行・列見出しを維持 | A1・A5 |
| resource / page model＋実 `SeriesAnalysisContent` の結合 | 選択表示・番手・ownerの対応を確認。A→Bの古い応答の後着、解除、初回失敗、cached一時失敗、404/410後の無効化と復帰。owner / 番手viewをmockしたprops検査だけで済ませない | A3・A4 |
| `MatchDetailPage.test.tsx` | 新HTTPでも通算平均順位の前後値・差分と注目点が同じ。excluded / 不存在では不正な派生値を残さず、保存済み試合結果は維持 | A4・A6 |
| 既存 `app-smoke.spec.ts` の比較導線＋Playwright MCP | 試合結果→前後の戦績→条件別→owner表→指標変更→解除・戻る・browser backとURL。実APIと現行Worker生成artifactで、owner訂正→旧分析から除外→通常の計算・公開→明示更新→新owner列を確認 | A1〜A4・A6 |
| production buildを使うbrowser実確認 | 広幅・狭幅、数値型1指標と長い順位分布で、文字標識・品質・固定見出し・hover・局所scroll・keyboard・focusを確認。ページ全体の不要な横overflowを生まない | A1・A2・A5 |

代表データは固定4人と異なるownerの2試合以上を用意し、選択ownerが最左列でない例、参考値、非選択の0戦列を含める。同ownerの別試合はcomponentで扱う。fixtureは既存factory / MSWへ集約し、遅延応答は制御可能にする。判定は実際の対象列・セル・値・選択表示で行い、マーカー個数だけをoracleにしない。

詳細分岐は適切なcomponent / repository層で証明し、全分岐をE2Eで重複させない。MSWだけをend-to-endの証拠とせず、新artifactを公開済みpayloadの直接修正で作らない。DOMと視覚確認から実screen readerの読み上げ回数まで保証しない。

SQL変更はarchitectureの性能確認に従い、隔離した合成データの通常件数・上限付近・上限超過で変更前後を比較する。主キーによる単一試合取得とbounded chunk read、既存の拒否境界を維持し、追加往復やartifact全体のdecodeを増やさないことを確認する。実行計画・転送量・buffer・時間を確認対象とし、運用実測値は公開文書へ置かない。分析engine全体の性能試験へは広げない。

| 必須gate | 実行内容 |
| --- | --- |
| 生成契約 | `apps/api` で `sbt apiOpenApi`、rootで `pnpm --filter web generate:api`。生成差分・構造lint・freshnessを確認 |
| API / DB | `apps/api` で `sbt apiQuality`、選択したunit / contract証拠とCI定義のtest単位、`sbt apiDbQuality` |
| Web | rootで `pnpm --filter web` に続けて `format:check`、`lint`、`contract:check`、`typecheck`、`test:run`、`build` を実行 |
| 主要UI flow・見た目 | 隔離環境のPlaywrightとPlaywright MCP。見た目の実確認にもPlaywright MCPを使う |
| 公開文書 | `git diff --check`、`pnpm public:safety:check` |

実DB / E2Eは通常利用のDB・Redis等と隔離し、既存bootstrapを使う。DB schemaやmigration stateを変更する必要が生じた場合は、先にAGENTS.md指定の隣接repository手順を確認し、範囲を再評価する。本案ではWorker / migration変更gateは対象外だが、SQLを変更するためAPIのDB gateは必須。coverage reportは診断情報として機能証拠と区別する。

## 7. リリース・完了条件

対応API/Webを同じrelease単位で切り替え、新Webが旧APIへ到達する組合せを作らない。実施時のrelease手順でこの条件を確認し、HTTP v3だけを先行公開しない。開いたままの旧Webは透過的に移行できず、再読み込みを必要とする。新規読込・再読込後の両画面を受入対象とし、旧Webからの失敗を正常動作や自動復旧として扱わない。既存の一般的なエラー回復表示を確認し、旧Web専用routeやreload専用応答は追加しない。

rollbackは対応するAPI/Webの組で戻す。本件はDBと保存artifactを変更しないため、MOM-22単独でデータ変換を戻す工程は不要。本番操作は[公開運用規約](ops/README.md)に従い、許可された作業の範囲で切替手順を具体化する。

実装完了は、A1〜A6の証拠と必要gateが揃い、残る制約が報告された時点とする。必要な検証の成功後は、結果を無効にする変更・失敗・具体的な未解決事項がなければ検証を広げない。

通常PRのbaseは `develop`、本文に `Fixes MOM-22` を記載する。releaseは[Git規約](dev-rule.md#8-git)に従い、対象PRと利用者向けRelease notes、対象issueを記載する。実装完了、release準備、本番反映を混同しない。

## 8. 実施結果（2026-09-24）

### 実装と検証で見つかった修正

APIはrevision検査と同じSELECTで取得したownerを型付きsnapshotで運び、保存chunkのdecode・checksum検証後にHTTP v3へ付加した。保存形式・Worker・DB schema・algorithmは維持した。両Web consumer、生成契約とquery keyも一体で移行した。

列強調は共通表の任意指定として実装し、同じ表示bundleから全7指標のowner見出しと4セルへ接続した。輪郭と「この試合のオーナー」を併用し、数値・戦数・品質表示は集計値を維持する。

検証と利用者レビューにより、次の3点を修正した。

- 成功済みcontextの再取得で404/410を受けた後、保持中のbundleや後続の一時失敗から古い選択情報が復活し得た。両consumerの共通取得境界に無効化結果を保持し、比較画面ではdeferred描画が追いつくまで旧contextを遮断する。aggregate取得が遅延・失敗した場合も、選択表示とowner・番手の強調を同時に外す。
- 実browserで指標変更時に操作領域が一時的にinertになり、focusが失われた。同じ内容のbundleを再利用して不要なdeferを防ぎ、実pageの回帰testとbrowserでfocus・局所scroll・URL・選択情報の保持、追加通信がないことを確認した。
- 利用者レビューで、各cellの内側の2px枠が行境界で重なり4pxに見えると指摘された。水平境界は上側のcellだけが描く方式へ変更し、列内と外周を2pxに揃えた。production buildを使うPlaywright MCPで広幅・狭幅、平均順位・順位分布、hover・局所scroll・固定見出し・指標切替時のfocusを確認し、強調の有無でcell寸法が変わらないことも確認した。主要導線E2Eの線幅検査も更新した。

### 受入証拠

| 条件 | 実施した証拠と結果 |
| --- | --- |
| A1・A2 | owner componentで全7指標、4人分の値、戦数・品質、同ownerの別試合・別owner・解除・不明・0戦・欠損を確認。共通表のopt-inとnative見出しも通過 |
| A3・A4 | 実resourceと表示componentでA→Bの遅延応答、解除、初回失敗、一時失敗、404/410、aggregate更新待ち・失敗からの無効化と復帰を確認。試合結果画面の通算平均順位・前後差・注目点と保存済み本体の保持も通過 |
| A3・A6 | 実PostgreSQLとproductionの試合更新経路でowner訂正後のrevision不一致・除外を確認。独立した実API・現行Worker環境では、訂正前のowner列、訂正後の旧context除外・全強調解除、通常計算による新artifact公開、再訪・明示更新後の訂正先owner列をPlaywright MCPで確認 |
| A4・A5 | production buildで広幅・狭幅、固定見出し、hover、局所横scroll、keyboard、指標変更時のfocus保持を目視・操作確認。主要導線E2Eで試合結果からの遷移、戻る・browser back、解除とURLを確認。ページ全体の横overflowなし |
| A6 | v3 schema・実応答・生成validator、旧routeの不在、新旧query shapeの分離、共通prefix reset・末尾paramsを確認。対応API/Webの切替・rollback条件は7節に記載 |

Worker生成の2試合は当初別ownerとし、選択列が最左でないことと非選択の0戦列を確認した。訂正後は同ownerの2戦となり、4人の平均順位が全員2.5位の集計値を保ったまま、そのowner列だけに見出しと4セルの強調が移った。公開済みpayloadの直接変更は行っていない。CLIの主要導線E2Eは分析応答を制御するtestであり、実Worker経路の証拠とは区別する。

SQLは隔離した合成データの通常・上限付近・上限超過で変更前後を比較し、単一試合のindex accessとbounded read、過大payloadの拒否を維持することを確認した。本番相当の性能保証には拡張しない。

### gateと残る境界

- API: `sbt apiQuality`、`sbt test`、`sbt apiDbQuality`が成功。DB gateは200 testsを通過した。
- Web: `format:check`、`lint`、`contract:check`、`typecheck`、`test:run`、`build`が成功。最終sourceで160 suites / 968 testsを通過した。lint・buildの既存warningは残る。
- 生成: `sbt apiOpenApi` と `pnpm --filter web generate:api` による正規生成、構造lint・freshnessを確認した。
- UI: 変更した主要導線のPlaywright testが成功。Playwright MCPでproduction buildと実API・Worker経路を確認した。
- 公開文書: `git diff --check`、`pnpm public:safety:check`が成功。

実screen readerの読み上げ、本番環境での性能、release切替は未検証。別端末の訂正を応答後に自動検出するpollingは追加しておらず、既存の明示更新・再訪で確認する。実装完了と本番反映を分け、対応API/Webの一括切替・旧Webの再読込・組でのrollbackをrelease時に確認する。Linearには受入条件と実施タスク、検証結果・PRを記録し、merge前にrelease完了扱いにはしない。
