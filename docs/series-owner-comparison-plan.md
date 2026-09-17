# オーナー別戦績比較 実装計画

対象: [MOM-3](https://linear.app/ponta/issue/MOM-3)。状態: **実装済み・隔離環境で主要受入を検証済み**（2026-09-18）。公開前に残る確認は7節に記す。

本書は [要求仕様](requirements/series-owner-comparison.md) と [実装仕様](series-owner-comparison-spec.md) を、変更単位・依存関係・完了証拠へ落とし込む。指標の意味と受入条件は要求仕様、payload・URL・移行契約は実装仕様を正本とし、ここで再定義しない。[敵対的レビュー](series-owner-comparison-review.md#5-実装仕様の敵対的レビュー) の指摘も各工程に割り当てる。

2026-09-17の [技術レビューK1〜K8](series-owner-comparison-review.md#6-実装計画の技術レビュー) を反映済み。React / Router / Query / Cats Effectの公式資料と実際の利用方法を照合し、性能効率性・保守性の受入条件を4節へ追加した。依存libraryのupgradeは含めない。

## 1. 必要十分性・実現可能性・提供価値の再評価

**確定済みの範囲で実装へ進められる。** 保存済みオーナーから既存scope内の4人の結果を分類でき、既存aggregateと「条件別」に接続できる。新しい入力項目・分析基盤・外部サービスは必要ない。主な工数とリスクは計算式より、成果物の世代移行と既存の画面状態の維持にある。

| 判断対象 | 採用する範囲と理由 | 実装後に確かめること |
| --- | --- | --- |
| 話のネタとしての価値 | 7指標を同じ4×4表で切り替え、名前・戦数・単位をその場で読めるようにする。違いが小さい記録も同じように扱う | 別端末で同じURLを開き、指定したプレーヤーのA/Bオーナー時の値と分母を特定できる |
| 数値の必要十分性 | 確定した順位・資産・物件収益・目的地・銀次を揃える。対象なしと観測0を区別し、少数試合には既存の参考値表示を使う | 数式が正しいだけでなく、銀次の遭遇率と平均回数を読み違えずに比較できる |
| 計算と保存 | 同一scopeの入力から専用の小さな集計を追加する。オーナーごとに高度分析やreview一式を再実行しない | scope数・job数・resource kindを増やさず、入力・出力と実行資源の既存上限を守る |
| 互換性の費用 | DBの契約拡張、旧・新reader、新aggregate経路は必要。移行中も既存分析を読める状態を守るための変更とする | 旧成功成果物を表示したまま再計算でき、新成果物へ一括で切り替わる |
| UIの変更範囲 | 共通select・書式・品質表示とDataTableを使う。共有部品への追加は行見出し固定と操作可能な局所scrollに絞る | PC・mobileの最小幅で名前と値の対応を失わず、指標変更でfocusや位置が飛ばない |

オーナーfilter、対象試合一覧、因果・公平性の判定、差の自動解説、Discord連携、owner専用通知、全APIのv3化、旧readerの撤去は今回の工程へ追加しない。汎用の多次元分析frameworkや新しいtable基盤も作らない。

利用者の選択が必要な仕様の未決事項は残っていない。実装と隔離環境での検証結果は7節に記録する。検証量の条件は利用者の回答に基づいて照合済み。本番移行と利用者本人による読解は、それぞれ別の確認として残す。

## 2. 作業単位と依存関係

| 工程 | 成果物 | 主な依存 | 受入条件・レビュー指摘 |
| --- | --- | --- | --- |
| P1 | 共有DBの契約拡張と確定したmigration pin | 確定仕様 | AC6・AC8、S1 |
| P2 | owner入力・集計・full validator・新旧schema・release互換性 | P1の契約。純粋計算とfixture作成はDB変更と独立して進められる | AC1・AC2・AC4・AC7・AC8、S1・S2、K1・K2・K6 |
| P3 | APIの両世代read、v3 aggregate、生成型・decoder | P1・P2 | AC6・AC7・AC8、S2、K5・K6 |
| P4 | Webの取得・cache・URL・navigation接続 | P3。URLの振る舞いの検証は先行可能 | AC5a・AC6、S3・S4、K3・K4・K7 |
| P5 | 7指標の比較表と既存画面への統合 | P3・P4。共有tableの操作検証は先行可能 | AC3・AC5・AC7、S5・S6・S7、K7・K8 |
| P6 | 実DBから画面までの受入証拠、最終resource検証、公開可能な候補 | P1〜P5 | AC1〜AC8とAC5a、全指摘 |

着手時には要求仕様の手計算例をP2のfixtureへ落とし込み、P4のnavigationとP5の狭い画面の表を先に検証対象として決める。大量のUIを作った後で集計の分母や表示方式を見直す工程にはしない。作成順と配置順は異なり、配置は6節のreader-firstに従う。

性能比較の条件と変更前の基準はP2/P3の実装前に固定する。fixture、scope構成、runtime/build、既存のbyte/node/入力/出力/concurrency/timeout上限、cold/warmの区別を記録し、P2とP3の終了時に代表例の差分を確認する。規定の連続実行と最終候補の確認をP6で行う。実測値・運用上限を公開文書へ転記しない。基準が既に要求を満たさなければ、その状態を候補の性能合格の根拠にしない。

### 変更で増やす責務の所有者

| 所有者 | 隠す判断・公開する最小の契約 |
| --- | --- |
| Rustのowner集計 | 正規化済みscope入力と固定rosterからowner payloadを作る。accumulatorや内部indexをcallerへ渡さない |
| Rustのpublication契約表 | active writerとreaderのexact pair、世代別descriptorを所有する。consumerは生成文書を使う |
| APIの既存chunk pipeline | pair選択・bounded検証・metadata hydrateを所有する。v2/v3は同じ処理結果をHTTP契約へ接続する |
| featureのURL管理とNavigation | URLの変更とvisitの適用をそれぞれ所有する。引渡すintentのtarget・寿命・取消条件を定義し、汎用event busは作らない |
| featureの指標定義 | URL ID・選択肢・既存formatter・payload参照先を一つの型付きcatalogで関連づける。数式は持たない |
| shared DataTable | table semantics・sticky/scroll/focusを所有する。owner、artifact世代、URLを知らない |

新しい公開関数やpropsには、入出力、不変条件、empty/error、intentの寿命などcallerが守る契約を短く記す。単なる転送hook、利用箇所ごとのversion判定、将来用の設定項目は増やさない。既存の大きなmoduleをこの機能と無関係な範囲まで分割しない。

## 3. 各工程の実装内容

### P1. 共有DBの受入契約を拡張する

変更入口はsibling `momo-db` の `src/schema.ts` と新しいforward migration、本repositoryの [.momo-db-ref](../.momo-db-ref)。DB編集・操作前にsiblingの `docs/development.md` の確認内容が現行であることを確かめ、[DB利用規約](db-rule.md) とそのauthoring手順に従う。

DB側の責務は実装仕様6節で定めた既存範囲に限定する。詳細計画・差分レビューでは、各変更を既存の制約・guard・初期化処理へ対応づけ、維持する不変条件と新世代対応の差分を示す。オーナー固有の業務判断はP2で扱う。実装時にmigrationの分割・順序・lock取得・consumer影響を確認し、既存の責務内で完了した。内訳と証拠は7節に記す。

1. 旧・新のschema/validation IDのexact pairを制約とpublication/pointer guardへ反映する。試合の列を増やさず、published成果物の不変性と未公開stagingの契約を維持する。
2. 新規bootstrapの初期tupleを新世代へ進める条件を、実装仕様6節に従ってmigrationに閉じる。作品数0だけを根拠にしない。稼働・登録履歴のあるDBは旧tupleを保ち、通常のpromotionへ渡す。
3. 宣言由来のDDLとfunction/trigger/preconditionのcustom SQLは正規の別migrationとして作る。既存migration・journal・snapshotを手で書き換えない。
4. freshと既存DBからのupgradeを別々に検証し、実在する完了commitへpinを更新する。未作成のmigration番号やcommitを仮置きしない。

完了条件: fixture操作より前のfresh tuple、旧・新pairの受理、交差pairの拒否、既存成果物の保持、稼働履歴がある0作品DBのtuple維持を実PostgreSQLで確認できること。DB migrationを通すためのfixtureによるsingleton上書きは証拠にしない。

### P2. Rustでowner集計と新しい成果物を成立させる

変更入口は [analysis-core](../apps/processing-worker/crates/analysis-core/src/)、[workerのseries_analysis](../apps/processing-worker/src/series_analysis/)、[共有schema/fixture](schemas/)。

1. `input_repository.rs` のSQL、`model.rs` の `PlayerMatchInput` と同一試合metadata検証、`artifact/build.rs` の `SourceRow` にownerを接続する。4行のowner一致・固定メンバー参照・入力上限・checksumへの反映をまとめて扱う。
2. `compute/aggregate.rs` から呼ぶowner専用集計を追加する。正規化済み入力を一度走査し、16cell分のcheckedな整数合計・順位別件数・遭遇試合数を蓄積して、最後に平均・率・品質へ変換する。親scopeが空なら仕様どおりの空構造を作る。`player_metrics` の丸ごと再利用、owner別の行vector、不要な中央値・sort・条件付き成績は加えない。共有するのは小さな数値・率・品質規則とし、既存 `metricsByPlayer`・review向け品質項目・item countの意味は維持する。
3. `payload.rs` と `payload/schema.rs` に新shapeと意味検証を追加する。要求仕様の手計算例を独立した期待値にし、不正な分母・率・欠落/重複・null・owner参照を拒否する。APIで同じ集計を再計算して検証しない。
4. 旧aggregate v3と新v4をRust所有の明示的なdescriptor/fixtureとして保つ。旧fixtureを新payloadで上書きせず、新旧schemaとpublication pairをexport・freshness確認の対象へ加える。publication文書は実装仕様6節の形式2へ改める。writer pairと `readableContracts` を一つのRust契約表から生成し、共有してよい不変のschema nodeと世代固有の差を分ける。旧descriptorへ新しい必須fieldを混入させない。
5. `contract.rs`・`control.rs` の世代を実装仕様6節に合わせ、`release.rs`・`release/maintenance.rs`・capability fixtureを新しいreader/writer profileへ接続する。readerの両世代対応をwriterと同じ単一配列で判定しない。registry凍結と既存lock順序を維持する。
6. `scripts/ci/analysis-smoke-safety.sh` の現行algorithm前提、release/control-plane smokeの単一reader前提を更新する。publication文書の形式・filename変更は `analysis-release-db-smoke.sh`、`series-analysis-control-plane-smoke.sh`、`processing-worker-preemption-smoke.sh` まで接続する。実際のfresh migrationと生成契約を入口にし、smoke内の補正で契約不一致を隠さない。通知consumerは新schemaを受け取れることと世代差分の既存比較可否を確認する。

完了条件: 0/1/2/3戦、偏った件数、負・0の金額、複数回の銀次、全scope、入力順変更の例が成立すること。owner訂正で4人が同時に別群へ移り、親scope指標は不変で、source checksumには変更が反映されること。新しい計算結果・validator・versionは同じ変更単位に含め、旧tupleで新payloadを公開できる中間状態を残さない。

主な証拠の追加先は `compute/tests.rs`、`fixture.rs`、payload/schemaの既存test、`artifact/tests.rs` とreleaseの実DB test。2接続でのregistry凍結、旧profile・未知値・交差pairの拒否、0-target promotionを既存の経路で確認する。

### P3. APIから新旧成果物を読めるようにする

変更入口は [PostgreSQL adapter](../apps/api/src/main/scala/momo/api/adapters/postgres/)、[SeriesAnalysisEndpoints](../apps/api/src/main/scala/momo/api/endpoints/SeriesAnalysisEndpoints.scala)、[SeriesAnalysisModule](../apps/api/src/main/scala/momo/api/http/modules/SeriesAnalysisModule.scala)、[response schema](../apps/api/src/main/scala/momo/api/contracts/seriesanalysis/SeriesAnalysisResponseSchemas.scala)。

1. `SeriesAnalysisArtifactSupport` のexact pair allowlist、reader capability登録、`PostgresSeriesAnalysisReadOps` のstatus、`PostgresSeriesAnalysisChunkOps` の同一snapshotでの選択を一緒に更新する。new desired/old currentをstaleとして読み続けられるようにする。
2. `SeriesAnalysisPayloadValidator` をartifact pairとresource kindで振り分け、旧・新validatorを起動時に初期化する。`ChunkCodec` のchecksum・要求identity・bounded read/renderと、共有metadata hydrateを維持する。v2/v3で同じrepository instanceとpermitを共有し、decode中にDB connectionを保持しない。cellごとの名前SELECT、requestごとのschema compile、旧・新validatorの順番の試行は加えない。
3. `/v3/aggregate` に旧v3/新v4のunion応答を追加する。`/v2/aggregate` は旧成功応答と新世代への426を区別する。認証・要求identity・成果物契約を先に確認し、不正artifactを単に「更新が必要」に変えない。426は返されたchunkの検証済みartifact metadataで判断し、render済みpayloadをもう一度parseしない。
4. API build inputと起動時loaderをpublication文書形式2へ更新し、Tapir/OpenAPI、Web生成型・runtime validatorまで通す。HTTP契約の生成識別子は `aggregateV2` / `aggregateV3` に分け、保存resource kindは `aggregate` のままにする。現行の [generate-api.mjs](../apps/web/scripts/generate-api.mjs) は重複kindを拒否するため、同じ識別子で2つの応答を登録しない。`ArtifactResourceKind` など生成応答の識別子を保存kindと誤読する型名も、利用境界で区別する。既存の生成処理を使い、全resource向けの新しいversion管理基盤は作らない。

完了条件: 実際のDB取得→raw検証→HTTP応答→生成decoderの経路で、旧・新と426を確認できること。`SeriesAnalysisPayloadValidatorSpec`、`SeriesAnalysisArtifactContractSpec`、`SeriesAnalysisHttpSpec`、`PostgresSeriesAnalysisRepositorySpec` など、該当する既存証拠へ統合する。旧schemaの同梱忘れ、artifact/scope混在、未知のpairを正のfixtureだけで見逃さない。

新旧endpointを混ぜた読取りでも共通のadmission上限を超えず、失敗・timeout・cancel後の次の取得が成立することを `PostgresSeriesAnalysisReadBoundSpec` と経路の結合証拠で確認する。既存のCPU処理の配置やthread poolを一般論だけで変更せず、同じ上限下で測定して判断する。

### P4. Webの取得契約とURL・navigationを接続する

変更入口は [shared/api](../apps/web/src/shared/api/)、[feature model](../apps/web/src/features/seriesComparison/model/)、[navigation](../apps/web/src/features/seriesComparison/navigation/)、[page model](../apps/web/src/features/seriesComparison/page/useSeriesComparisonPageModel.ts)。

1. `seriesAnalysis.ts` のaggregate facadeを生成union型へ接続し、versionに依存しない名前にする。新endpointと対応するdecoderを使い、既存component・fixtureの型参照も揃える。
2. `queryKeys.ts` の既存artifact prefix配下でaggregateだけに新wire identityを加える。`seriesAnalysisQueryOptions`、resource取得・失効回復・明示更新・mutation後の無効化が同じfactoryを通ることを確認する。`ownerMetric` はquery key・scope signatureに含めない。
   `keepPreviousData` の成功扱いや新しいstatusだけでowner表を有効化せず、既存のdisplay bundle・artifact/scope identity確認を維持する。owner値だけを別cache/local stateへコピーせず、生成unionをowner節への入口で絞り込む。componentごとにversion判定や型castを散らさない。
3. `seriesAnalysisViewModel.ts` と `useSeriesAnalysisLocationState.ts` で7候補のparse/normalize/serializeを扱い、未指定は平均順位、不正値は既存notice付きの補正とする。指標変更ではscope・view・focusMatchId・safe returnToを維持し、作品・scope・view変更ではownerMetricを保持する。作品変更時にstateを再構築する経路にも接続し、既存のscope/focus正規化は維持する。
4. search・hash・保持するlocation stateを一度のnavigationで更新する。URL更新をselect自身のeffectと既存canonical化effectへ分散しない。Routerのsearch paramsを直接変更せず、同一操作系列の未commit targetも含めて純粋に次のURLを組み立て、古いcanonical化が後続の指標/scope変更を上書きしないようにする。`setSearchParams` の複数callback呼出しがReactのstate更新のように合成されるとは仮定しない。
5. 表示変更intentをpage内のmemoryで保持し、location hookからpage modelを経由して `SeriesAnalysisNavigation` へ渡す。現在はpage modelがNavigation providerの外で動くため、hookからそのcontextを直接読む設計にはしない。source visit・操作ID・targetを結び、commitしたtargetのvisitへ冪等に位置保持を引き継ぐ。既存 `Visit.begin()` がhandledを戻すことも考慮する。render中にintentを消費せず、Strict Modeのeffect再実行、連続操作、POP、unmountで誤適用・消し忘れを起こさない。Routerの `preventScrollReset` だけでfeature固有の到着処理が止まるとは扱わない。

完了条件: 指標変更で追加request、取得中の遮蔽、履歴の追加、focus/scroll喪失が起きないこと。目次を使わず表へ到達した場合、連続canonical化、指標→scopeの素早い変更と遅れて届く応答、目次移動後のback、詳細往復、新規URL・reloadを既存routerを通して区別する。実appと同じData Router/Strict Mode・実際のshared Selectを使う代表結合testを、既存navigation/query/resourceのtestへ組み込む。途中状態だけをmockしたURL文字列のtestで完了扱いにしない。

### P5. 共通UIでオーナー比較を実装する

変更入口は [DataTable](../apps/web/src/shared/ui/data/DataTable.tsx)、[条件別view](../apps/web/src/features/seriesComparison/page/SeriesAnalysisContextView.tsx)、目次、`SeriesAnalysisViewPrimitives.tsx`、既存formatter・品質表示。ownerの行/列・指標表示はfeature内の専用componentへまとめる。

1. DataTableへ行見出し固定とlabel付きのkeyboard操作可能なscroll領域を任意指定で加える。CSSでstickyとscrollを成立させ、row/column headerの交点・背景・包含範囲を含める。高さ/幅の配置はfeature、内部scrollとfocusの契約はsharedが所有する。overflow hintに測定が必要ならscroll領域単位へ閉じ、cellごとのobserver・scrollごとの全表再計算は避ける。順位分布の高さでも列見出しを見失わず、既存consumerのdefaultを変えないことを確認する。
2. 「条件別」の番手比較の後へ `metric-owner` を追加し、共通 `AnalysisSection`、`SelectField`、書式、`QualityAdvisory` を接続する。表DOMとselectを指標ごとにremountしない。順位分布は既存rank tokenと可視の件数・率を使い、番手比較のcell装飾やfocus itemの強調をコピーしない。
3. 新aggregateの通常・1オーナー・0戦列、旧aggregateのdisabled selectと理由、親scope全体の共通空表示をつなぐ。表示bundleの世代で判定し、旧値の表示中にdesiredだけを見て新しい節を有効化しない。
4. 目的地平均・銀次平均の共通指標定義を足す。銀次遭遇率のhelpは共通定義と、そのviewで実際に見られる関連指標の読み方に分ける。owner表に存在しない遭遇時順位・資産の説明を流用しない。

URL ID・select候補・payload参照・formatterの対応は一つの型付きcatalogで定義する。選択値とrowsはURLと表示bundleから導出し、同期effectや第二の楽観stateを作らない。16cellのための仮想化・全画面store・新たなmemoization層を導入せず、必要性が測れた箇所だけを最適化する。

完了条件: 全7候補の単位と表見出しが一致し、対象なし・観測0・参考値・同値を区別できること。長い名前、負の大きな金額、順位分布を含むfixtureで、ページ全体の横overflow、scrollのfocus trap、行列の取り違えがないこと。DataTableの既存利用箇所も代表例を確認する。見た目と操作の実確認はPlaywright MCPで行う。

### P6. 利用者の結果までつないで検証する

1. 隔離DBに要求仕様の架空例を登録し、worker生成→API→Webで表示する。通常の試合更新経路でownerを訂正し、再計算後に4人分が移ること、親scopeの既存指標が変わらないことを確認する。追加・削除・scope変更は同じ再計算契約に沿う代表例で確認する。
2. 旧成功artifact→新desired→計算中/失敗→新成功artifactの遷移、旧Webの426、期限切れ回復を確認する。既存の「今の差」「番手比較」「スリの銀次」「振り返る」と通知consumerへの回帰を変更境界に合わせて選ぶ。
3. PC・mobileの代表幅と各layout modeの最小幅で、[要求仕様の読解課題](requirements/series-owner-comparison.md#表から答えを得られることの確認) を行う。同じURLを別browser contextで開き、作品・scope・指標・節と値を特定する。説明文、表の行列、戦数を含めた読解を確認し、数値の存在だけで成功としない。
4. [分析バッチのresource要求](requirements/series-analysis-batch.md) に従い、2節で固定した基準と最終候補を比較する。全scope・連続実行のworker時間/メモリ、成果物サイズ、APIのbounded decode/render、Web転送・表示への影響を確認する。入力増加とscope数増加、少数ownerへの偏り、長い文字列、既存の入力/出力上限近傍を区別する。固定16cellという推論を測定の代用にせず、超過時は重複計算・不必要なdecodeから修正し、先に上限を緩めない。
5. 通った証拠と未確認事項をPRへ記録し、要求/実装仕様と実装差分を照合する。実装で契約が変わった場合はその正本を更新する。エージェントの読解確認と、利用者本人が説明なしに読めた証拠は区別し、後者を代行したと報告しない。

完了条件: 必須gateと選択した受入証拠が揃い、既知の不整合が解消していること。CI成功、画面の見た目、数値の正しさ、性能はそれぞれの保証範囲で報告する。

## 4. 検証の割当てと終了条件

以下は今回の実装に適用したgateである。実行結果と保証範囲は7節に記録する。現行commandの正本はpackage manifest・build設定・CI、選定基準は [Change Gates](dev-rule.md#4-change-gates) と [テスト・品質規約](test-rule.md) とする。

| 境界 | 選ぶgate・実行入口 | 主に検出する失敗 |
| --- | --- | --- |
| DB / release | siblingの正規migration検証、APIの `apiDbQuality`、既存release/control-plane smoke | freshと稼働DBの取り違え、制約/guard不整合、非互換profileの昇格、部分公開 |
| Worker | `pnpm analysis:format:check`、`analysis:lint`、`analysis:test` 内の該当証拠、production image buildと変更経路のimage/control-plane smoke | 集計・入力checksum・full validation・exportの不整合、production runtimeとの不一致 |
| API / wire | `pnpm api:quality` と該当unit/contract、`apiDbQuality`、Tapirの `apiOpenApi`、Webの `generate:api` / `contract:check` | 新旧取得・426・metadata・生成型のずれ、旧schema同梱漏れ |
| Web | `pnpm --filter web format:check`、`pnpm web:lint`、`web:typecheck`、該当component evidence、`web:build` | unionの扱い、cache衝突、URL状態・focus・表示状態の不整合、validatorのbuild漏れ |
| 横断・視覚 | Playwright MCPによる主要flowとmanual review、規定のresource/endurance evidence | 別端末で同じ比較へ到達できない、訂正が表示へ届かない、狭い画面で読めない、負荷超過 |
| 文書 / 公開情報 | `git diff --check`、`pnpm public:safety:check` | 文書差分の不備、公開してはいけない情報の混入 |

数式はRust、DBのguardとpromotionは実DB、focusと履歴はrouterを通す操作、視覚的な読解は実画面で証明する。同じ期待値を全層へ複製するtestや、実装をなぞるcheckerは追加しない。CIが定める必須suiteは守り、必要なgateが通った後の追加実行は新しい変更・失敗・未解決事項の影響範囲に限る。

適用した教訓は、契約と生成物を一緒に扱うL7、負荷・世代・fresh baselineを分けて確認するL8、DB所有者のauthoring手順に従うL13。詳細は [教訓カード](post-mortem/lessons.md) に委ねる。

### 性能効率性・保守性の受入条件

[ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) の製品品質モデルを使い、以下をMOM-3の設計・検証へ対応づける。規格がこのアプリのms・MB・合格率を定めているという意味ではなく、具体的なoracleは要求・既存設定・以下の変更契約から選ぶ。規格資料と適用の根拠は [技術レビュー](series-owner-comparison-review.md#6-実装計画の技術レビュー) に記録する。

| 観点 | この変更の受入条件と証拠 | 工程 |
| --- | --- | --- |
| 時間特性 | owner増分は一度の入力走査。worker計算、API read/decode/render、Webの初回と指標切替を別々に測る。指標切替の追加requestは0。通常/cold/warm/連続の既存応答・timeout要求を満たす | P2・P3・P6 |
| 資源利用 | ownerの集計状態は固定16cell。入力owner追加は行数、出力追加はscope数に応じて増えると見積もる。APIのpermitと短いDB transactionを維持し、全作品decodeやowner別queryを増やさない | P2・P3・P6 |
| 容量 | 規定fixtureに加えて多scope・偏り・長い文字列・上限境界を確認する。超過時は既存の失敗契約に従い、黙った切詰め・scope省略・部分公開をしない。新旧endpointを混ぜても共通の同時実行上限を守る | P2・P3・P6 |
| モジュール性 | 2節の所有者に意味・状態・表現を閉じる。URL/Query/共有tableの責務を混ぜず、accumulatorやgeneration判定をcallerへ漏らさない | P2〜P5 |
| 再利用性 | 小さな数値規則、既存のreader pipeline、formatter、Select/DataTableを再利用する。再利用のためだけに不要な分析や汎用frameworkを加えない | P2・P3・P5 |
| 解析性 | 集計不変条件、pair不一致、形状・上限、URL競合を既存の安全な失敗分類と有限のfield pathで識別できるようにする。raw payload・表示名・secretをlogへ出さず、失敗fixtureから原因と修正先を辿れる | P2〜P4 |
| 修正性 | writer/reader pairはRustの契約表、指標の表示対応はfeatureのcatalogに集約する。新旧schema分岐を各cellへ散らさず、旧descriptor変更の影響をfixtureと生成差分で確認する | P2〜P5 |
| 試験性 | 手計算・入力訂正、実DB制約、実router/Strict Mode、共通admissionの失敗後回復を各所有境界で確認する。generatorの出力をそのまま唯一の正解にせず、同じ数式の全層複製もしない | P1〜P6 |

性能のblocking条件は既存の明示した上限・応答要求と追加計算の契約違反とする。変更前後の差分と測定のばらつきは原因を調べる証拠にし、根拠のない一律の増加率を新しいgateにしない。必須の性能要求や上限が測定条件に対応づけられない場合は合格とせず、その確認を残す。ISOの項目ごとに新しいcheckerや重複test suiteは作らない。

## 5. 変更のまとめ方

- 共有DB側のPRでmigrationとその証拠を確定させ、アプリ側はそのcommitをpinする。DB変更をこのrepositoryの独自SQLへ逃がさない。
- アプリ側はP2〜P6を一つのMOM-3の変更として揃える。レビューは上記工程ごとのcommit/差分で区切り、consumer対応のない計算変更だけを公開可能な候補にしない。通常PRのbaseは `develop` とする。
- MOM-3を完了させる通常PRに `Fixes MOM-3` を記載する。途中のDB準備だけをissue完了にしない。release PRと利用者向けRelease notesは [Git規約](dev-rule.md#8-git) と [PR template](../.github/pull_request_template.md) に従う。

新旧のreader/workerを同時に扱う必要があるため、今回の工程分割を独立した本番配備の回数へそのまま対応させない。

## 6. 公開準備と公開後の完了

公開順序の契約は [実装仕様7節](series-owner-comparison-spec.md#7-新旧混在と公開の順序) に従う。実装が揃った後、同じ検証済み候補の中で次の接続を確認する。

1. DBは旧・新pairを受け入れ、稼働DBの旧active tupleを保つ。
2. APIを両世代readerと新endpointに対応させ、新Webを配置する。新workerが生成を始めるより先に新成果物を読めるようにする。
3. 新workerのcapabilityを揃え、既存の昇格処理でregistry検証・desired更新・campaign作成を行う。全作品の過去分と全有効scopeを再計算する。
4. campaign対象の終端と成果物・契約の監査を確認する。queueが空になったこと、enqueue成功、health成功だけで完了にしない。

不適合時は失敗した工程で止め、表示できる直前成果物を維持する。最初の新世代公開後も新成果物を読めるreaderを保ち、rollback対象と監査条件を確認する。旧decode撤去は別変更へ残す。

本番操作の境界は [公開運用規約](ops/README.md) に従う。本計画は公開操作の実施・承認記録ではない。実装と隔離環境での受入完了、公開準備完了、実際の公開・backfill完了を分けて報告する。

## 7. 実装・検証記録（2026-09-18）

P1〜P5を実装し、P6の機能・互換性・実画面・代表fixtureでの資源検証を隔離環境で行った。実測値・実行環境の詳細は公開文書へ置かず、以下では保証した契約と残る確認を記録する。

### 共有DBの変更と責務

[.momo-db-ref](../.momo-db-ref) は `8eecff3846210f278740d9b9770a717d34f71704` を指す。元のsibling checkoutを保ち、別worktreeで作成・検証・commitした。既存migrationを書き換えていない。

| migration | 既存責務への対応 | 維持する条件 |
| --- | --- | --- |
| 0046 | 通常のrelease lockを取得して後続DDLの順序を揃えるcustom migration | migration全体を正規migratorのtransactionで適用 |
| 0047 | Drizzle生成のpair制約・default更新 | 旧・新のexact pairを受理し、交差pairを拒否 |
| 0048 | 既存のpublication / pointer guardの新pair対応 | published成果物の不変性、stagingと参照の制約 |
| 0049 | 未稼働DBの初期tupleだけを進めるcustom migration | stale / drainingを含む登録・稼働履歴があれば旧tupleを保持 |

試合列、オーナー別の数式、分母・品質判定、成果物の意味検証をDBへ追加していない。これらはRustが所有する。migration SQLのlock順序・transaction・名前・`search_path`・既存triggerとの関係を確認し、共有通知のschemaや型は変更していない。

### 実行した証拠

| 境界 | 結果と保証範囲 |
| --- | --- |
| momo-db | `build`、`db:check`、`test:migrations`（6件）通過。fresh tuple、旧DBのbackup / restoreからのupgrade、旧row / pointer / checksum保持、交差pair拒否、稼働履歴がある0作品DBを確認 |
| Rust | format、Clippy、workspace test通過（analysis-core 62件、OCR 18件、worker 174件）。DB / Redisを使う対象の12件も明示実行。手計算例、owner訂正、全scope、0/1/2/3戦、入力順、意味検証とschema exportを確認 |
| API | `apiQuality`、通常test（468件）、`apiDbQuality`（166件）、OpenAPI生成・freshness通過。両世代read、旧current / 新desired、pairとpayload不一致、共通admissionの上限・取消・回復を確認 |
| Web | format、lint、typecheck、contract check、build通過。全suite 901件に加え、最終wire境界とowner表示の対象17件を実行。旧wireの新payload拒否、新wireの両世代受理と必須owner欠落拒否を確認 |
| runtime / release | workerとアプリのproduction image build、image scan、Dockerfile lint、image / release DB / control-plane / preemption / runtime HTTP smoke通過。childの上限超過、回収後の次処理、世代移行を確認 |
| 既存通知consumer | 変更後DB packageを使った隔離copyのSummitでtypecheck / build、既存通知契約・renderの20件を確認。新identityの受入と世代差分の既存incomparable表現も確認。外部送信は実施していない |
| 公開情報 | `git diff --check`、`public:safety:check`を実行。ローカル測定・画面証拠はcommit対象外 |

### 利用者の結果と実画面

Playwright MCPで、通常APIによる3試合の登録からworker生成、API取得、Web表示までを通した。2試合目のownerを通常の更新APIで訂正し、4人全員の値が同時に別の列へ移り、親scopeの既存指標が変わらないことを確認した。新aggregateのHTTP成功、旧aggregate endpointの426も実応答で確認した。

7指標の切替、Nと参考値、対象なしと観測0、銀次の遭遇率と平均回数、同じURLの別contextでの復元を確認した。指標切替は追加取得・履歴追加・inert化を起こさず、selectのfocusと読んでいる位置を保持した。router / Strict Modeの操作証拠で、連続操作とcanonical化の競合も確認した。

PCと320 / 360pxのmobile幅で、行列見出しの固定、局所scroll、keyboardでの到達・離脱を確認した。長い表示名の折り返し不備は実画面で検出して修正した。大きな負の金額と順位分布も同じ表で確認した。これはエージェントによる読解・操作確認であり、利用者本人の読解成功とは区別する。

### 資源検証と公開前に残る確認

固定4人・500試合・全9scope・オーナー数の偏りを持つfixtureを、変更前後それぞれ100回実行した。100開催に分けた代表fixtureも同条件で実行した。production相当の制限下で、worker / child / 一時成果物の既存上限、連続実行後の回収とメモリ推移を確認した。APIは最終イメージで代表fixtureのbounded read / renderと同時読取り、Webは初回取得・保存済み表示・指標切替を確認した。既存上限を緩めていない。境界負荷でのreader拒否は、代表負荷の成功と分けて扱った。

2026-09-18の利用者の回答に基づき、検証済みの500試合が全作品の現在件数の2倍以上であることを確認した。「最低500試合/作品」と併せて検証量の条件を満たすため、この照合の保留は解消した。これは利用者の申告を根拠とする確認であり、実DBを照会した証拠ではない。コード・fixture・実行条件は変わらないため、既存の変更前後各100回の検証結果を再利用する。

- 本人が説明なしに値・分母を読み取れたという証拠は未取得。
- DB commitの共有・merge、アプリのpush / PR、本番DBへのmigration、本番でのreader-firstの配置と過去分再計算は未実施。ローカルでの完了を、本番公開やbackfillの完了として扱わない。

### ローカル開発環境の移行と後片付け

ローカル開発DBのbackupを復元したコピーで既存migrationの適用とデータ保全を確認した後、開発DBへ適用した。現行APIとworkerの実登録による互換性確認を経て、release CLIのdry-run / applyで新世代へ昇格し、再集計の完了とcurrent / quiescent監査を確認した。開催・試合・設定などの保存データを前後で照合した。

MOM-3専用の一時worktree、consumer検証copy、検証container・image tag・一時ファイルを整理した。必要な検証証拠は追跡外のarchiveへ、backupとローカル移行の記録は追跡外の領域へ保存した。要求・実装仕様・採用判断と受入証拠は引き続き本書と参照先に残す。
