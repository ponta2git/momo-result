# オーナー別戦績比較 実装仕様

対象: [MOM-3](https://linear.app/ponta/issue/MOM-3)。状態: **実装済み**（2026-09-18）。検証結果と公開前の残件は [実装計画7節](series-owner-comparison-plan.md) を参照する。

2026-09-17の [敵対的レビュー](series-owner-comparison-review.md#5-実装仕様の敵対的レビュー) を反映済み。要求・規約との不整合を修正し、実装へ反映した。公開は未実施。

[実装計画の技術レビュー](series-owner-comparison-review.md#6-実装計画の技術レビュー) も反映済み。計算増分、読取り資源の共有、publication契約文書の形式、表示変更intentの寿命を具体化した。

[要求仕様](requirements/series-owner-comparison.md) の利用者との合意を、現行コードと規約に照らして実装契約へ具体化する。目的・指標の数式・表示の意味・受入条件は要求仕様を正本とする。本書は変更後の契約と移行方針を定める。実装・隔離検証と本番公開の状態は分けて扱う。実装後の機械可読なshapeはRust所有のJSON Schema、HTTPはTapir、DBはmomo-dbを正本とする。

## 1. 規約との対応と採用する構成

| 確認した正本 | 今回の決定 |
| --- | --- |
| [ドメイン規約](domain-rule.md)、[戦績比較](requirements/series-comparison.md) | 保存済み `ownerMemberId` で確定試合を分類する。固定4名全員の成績を使い、分母はオーナー別の試合数とする |
| [構造規約](architecture.md)、[分析バッチ](requirements/series-analysis-batch.md) | Rustで既存scopeごとの集計を事前計算し、既存aggregate resourceへ含める。API・Webに意味計算を移さない |
| [DB利用規約](db-rule.md)、`../momo-db/docs/development.md`（全文確認） | 試合列・scope・分析resource用の表は増やさない。新しい成果物の検証契約を受け入れるforward migrationは必要 |
| [UI規約](ui-rule.md) | 「条件別」の番手比較に続く節、プレーヤー行×オーナー列、共通select・formatter・品質表示・空状態・移動処理を使う |
| [テスト・品質規約](test-rule.md)、[Change Gates](dev-rule.md#4-change-gates)、[教訓カード](post-mortem/lessons.md) | 手計算例、実DBの契約、生成契約、実画面の操作・読解、resource境界を別々の証拠で確認する。文書検証を実装の動作証拠にしない |

追加する集計は7指標、4プレーヤー×4オーナーの固定サイズとする。オーナーごとに既存aggregate・高度分析・review一式を再実行しない。既存scope、resource kind、ジョブ数、公開単位、通知の提供機能を増やさない。

owner集計は正規化済みscope入力を一度走査する固定サイズのaccumulatorとする。scope内のプレーヤー行数を `R_s` としたとき、追加計算は `O(R_s + 16)`、集計用の追加作業領域は `O(16)`。既存の重い `player_metrics` やowner別の行vectorを再利用手段にせず、数値変換・率・品質判定などの小さな規則だけを共有する。この見積りはowner集計の増分であり、全分析の計算量、入力のowner文字列追加、全scopeの出力サイズが一定という意味ではない。

## 2. 分析入力と更新

- `input_repository.rs` の同一snapshotからのSQL読取り、`PlayerMatchInput`、checksum用 `SourceRow` に `ownerMemberId` を追加する。既存の入力件数・文字列・byte上限にもこのフィールドを含める。
- 同一試合の4行でオーナーが一致し、参加する固定メンバーのいずれかであることを、既存の試合metadata整合性検証に加える。不明・欠落・不一致を別のオーナーへ補正せず、その作品の計算を失敗させる。
- 分類のキーはmember IDとする。表示名は入力checksumに含めず、既存のmetadata hydrateで取得する。
- 通常の試合更新transactionが既に分析revisionと再計算要求を更新するため、オーナー訂正専用の再計算経路は作らない。入力checksumにはオーナー値自体を含め、revisionだけに依存しない。
- 保存済み試合の再入力やデータ補正は行わない。過去分も新versionで再計算する。オーナーだけの訂正では4人分が一緒に移り、親scopeの既存指標値は変わらない。

## 3. 成果物の契約

### 配置とshape

aggregateの `schemaVersion: 4` に必須の `ownerComparison` を追加する。既存フィールドの意味は保持する。以下はフィールド定義であり、TypeScriptでwire型を手書きする指示ではない。

| フィールド | 構造・意味 |
| --- | --- |
| `ownerComparison.owners` | 列順の配列。各要素は `memberId`, `targetCount`, `qualityStatus`。`targetCount` は `N_o` |
| `ownerComparison.recordedOwnerCount` | `targetCount > 0` のオーナー数。workerが確定する整数 |
| `ownerComparison.rows` | 行順の配列。各要素は `memberId`, `cells` |
| `rows[].cells` | `owners` と同じ順序の配列。各要素は `ownerMemberId` と次表の全指標を持つ |

| cellのフィールド | 値 |
| --- | --- |
| `rank.average` | 平均保存順位 |
| `rank.distribution` | `rank`, `count`, `rate` を持つ4要素。1〜4位の順。1位率はここから読む |
| `assets.average` | 総資産の平均。保存単位の万円 |
| `revenue.average` | 物件収益の平均。保存単位の万円 |
| `destination.count`, `destination.average` | 目的地回数の合計、合計 / `N_o` |
| `ginji.count`, `ginji.average` | 銀次回数の合計、合計 / `N_o` |
| `ginji.encounterMatches`, `ginji.encounterRate` | 本人が1回以上遭遇した試合数、その試合数 / `N_o` |

- 親scopeが1戦以上なら `owners` と `rows` はいずれも既存の `players` と同じ固定4名・同じ順序、各行の `cells` は4要素とする。対象0戦のオーナーも含める。重複・欠落・未知の参照・順序違いを許さない。
- 親scopeが0戦なら、現行の空scopeに合わせて `owners: []`, `rows: []`, `recordedOwnerCount: 0` とする。必須フィールド自体は省略しない。Webは共通EmptyStateを表示するため、全0戦の比較表を組み立てない。
- `owners[].memberId` と `rows[].memberId` は既存のmember参照としてAPIが `displayName` をhydrateする。cellは `ownerMemberId` で列を参照する。名前を集計キーにせず、表示名取得をcellごとの問合せにしない。
- 対象0戦のcellでは件数・回数のcountは0、平均と率はすべて `null`、順位分布は4要素のcountが0・rateが `null`。Webは列の `no_target` に従い補助countも「0回」と表示しない。対象ありの観測値0は0として表示する。
- 平均・率は表示用に丸めず、有限数を保存する。率は0〜1、平均順位は1〜4。整数の合計はoverflowを検出し、既存入力上限の下でJSONの安全な整数範囲に収める。NaN・Infinity・負の0の扱い、canonical encodingは既存の成果物規則に従う。
- ownerの品質は `N_o = 0` で `no_target`、1〜2で `reference`、3以上で `ok`。7指標と4人に共通なので列に一つ置き、cellへ同じ品質・分母を重複して持たせない。
- 既存 `dataQuality.items` とそのsummaryは親scopeの従来指標のままとする。owner列の品質は `ownerComparison` 内で閉じ、親scopeやreviewの品質件数へ加算しない。
- owner cellにdrilldown用の `itemId` や根拠試合IDは付けない。aggregate chunkの `item_count` は従来どおりscope内のプレーヤー明細数（4 × 親scope試合数）であり、16cellへ置き換えない。

### 検証責務

Rustの計算・full semantic validator・schema exportを一緒に変更する。validatorは上記の集合・参照・null・品質・数値境界に加え、オーナー別試合数の合計、`recordedOwnerCount` と対象ありの列数の一致、各cellの順位件数合計、平均順位と順位分布の整合、同じownerの4人分の各順位件数合計が `N_o` であることを確認する。目的地・銀次の平均とcount、銀次遭遇率と遭遇試合数、遭遇試合数 ≤ count・`N_o`、銀次countが0の場合と遭遇試合数が0の場合の一致も検証する。整数は正確に比較し、件数から決まる平均・率は同じ整数分子と分母による除算結果に一致させる。表示用に丸めた近似値を成果物へ保存しない。

保存入力による分類・数式の正しさは、要求仕様の手計算例とDB入力を通す証拠で確認する。APIはattestationのexact pair、生成schema、checksum・上限・要求identityを検証し、owner集計を再計算しない。Webも平均・率・品質・記録のあるオーナー数を計算し直さない。

## 4. HTTP・生成型・既存consumer

新しいaggregate取得経路は `GET /api/analytics/series-comparison/v3/aggregate` とする。認証、読取り権限、rate limit、cache方針、scopeとartifact pinning、期限切れ時の回復は既存aggregateと同じにする。

旧Webのdecoderは必須・追加フィールドを厳密に検証するため、既存v2へ新bodyを無条件追加する案は採らない。新経路はaggregateだけに限定し、変更のない取得経路を一括でv3へ改番しない。

| 経路・consumer | 確定する扱い |
| --- | --- |
| 新 `/v3/aggregate` | 新aggregate v4と、移行中の旧aggregate v3のdiscriminated unionを返す。判別子は既存の `schemaVersion`。双方とも保存済みの同じ成果物を返し、欠けたowner値を合成しない |
| 既存 `/v2/aggregate` | 旧aggregate v3を読める間は従来応答。選択された新成果物には既存のHTTP 426 / `ANALYSIS_CLIENT_UPGRADE_REQUIRED` を返し、旧Webの再読み込み導線へつなぐ。新bodyを旧schema名で返さない |
| `/v2/options`, `status`, `review`, `drilldown`, `match-context` | URLとpayloadのschemaVersionを維持する。新artifact世代のmetadata・attestationを扱えるようreaderを更新する |
| APIのshape検証 | 認めたartifact世代とresource kindから該当schemaを選ぶ。旧aggregate v3と新v4のvalidatorを起動時に初期化し、無関係な世代とpayloadの組合せを拒否する |
| OpenAPI・Web型 | Rustのraw schemaとTapirのHTTP envelope・metadata projectionから生成する。新aggregateのunionも生成経路に載せる。Web facadeはversionに依存しない名前にして生成型を参照する |
| 通知・review・既存分析 | 親scopeの既存指標は維持する。owner向け通知・reviewを追加しない。世代をまたぐ通知差分などは既存の比較可否規則に従い、旧成果物との差を無理に生成しない |

両世代対応は次の経路を一組として変更する。validatorの追加だけでreaderの対応完了としない。

| 接続点 | 守る条件 |
| --- | --- |
| `SeriesAnalysisArtifactSupport` とcapability登録 | Rust所有の旧・新exact pairを一つのallowlistから参照する。schema集合とID集合を別々に満たすだけでは許可しない |
| statusのdesired / 表示可能artifact判定 | desiredが新契約でも、旧契約の成功artifactをstaleとして読める。未対応・不正状態を0件に置き換えない |
| `PostgresSeriesAnalysisChunkOps` のSQL | current / previousとの対応・上限付きpayload取得を同じread snapshotで行い、旧・新exact pairのどちらも選べる。定数だけを新世代へ置換して旧artifactをexpiredにしない |
| raw payload検証 | 選ばれたartifactのschema・検証ID・resource kindでvalidatorを決める。payloadの自己申告 `schemaVersion` だけではvalidatorを選ばない |
| HTTP応答とWeb decoder | v2 / v3で別のnamed responseと生成validatorを使う。認証・要求identityと成果物契約を検証した上で、v2が扱えない新世代には426を返す。新payloadを旧decoderへ渡して一般エラーにしない |
| schema exportとbuild input | 旧raw schema・旧publication pairもRust所有の明示的な互換契約として維持し、新契約とともに生成・freshness確認・APIへの同梱対象にする。Web生成物や一時的な旧ファイルの残存に依存しない |

API入力へ `ownerMemberId` や選択指標を加えない。新経路の全指標は一度のaggregate読取りに含む。選択指標をresource query keyやscope signatureへ加えず、切替だけでは通信・再計算・取得中の遮蔽を発生させない。

v2/v3は同じread usecase・repository instance・decode admissionを共有し、endpointごとに別の同時実行枠を作らない。既存のrate limit分類、短いDB transaction、取得からbounded renderまでのpermit、timeout・失敗・cancel後の解放を維持する。validatorは起動時に初期化し、pairに対応する一つを選ぶ。requestごとのschema compile、旧・新validatorの順番の試行、426判定のためのresponse JSON再parseは追加しない。426の判定には検証済みchunkのartifact metadataを使い、raw本文は既存の一度のpipelineで検証する。

一方、aggregate応答のshape変更はcache identityへ反映する。既存 `seriesAnalysisKeys.artifactRoot()` の配下でaggregate keyに新wire契約の区別を加え、旧aggregate型と新union型を同じkeyへ置かない。resource取得・失効回復・明示更新・mutation後の無効化で同じkey factoryを使い、変更のないreview等を一律に改番しない。

### 取得状態とオーナー節

| 状態 | 表示・操作 |
| --- | --- |
| 表示できる成果物がない、または親scopeが0戦 | ページ共通のloading / error / EmptyStateを優先する。オーナー節の空表・別の取得操作は作らない |
| 親scopeに試合がある旧aggregate v3 | 既存分析と節見出しを表示する。指標selectはURLの現在値を保持してdisabledにし、「オーナー比較は分析結果の更新後に表示されます。」をその理由として対応づける。ownerの表や0値は合成しない |
| 新aggregate v4、記録のあるオーナーが1人 | 4列と値を表示し、「この範囲で記録があるオーナーは1人です。」を短く添える。プレーヤーが不足しているとは表現しない |
| 新aggregate v4、記録のあるオーナーが2人以上 | 通常の4×4比較。対象0戦の列も維持する |
| 更新中・失敗時に旧表示を維持できる | 共通の状態表示と「表示を更新」に従い、実際に表示している成果物の世代で上記を分岐する。desiredだけでowner表示を有効にしない |

旧データの説明は計算が進行中・成功済みだと断定しない。節固有のspinner、再試行button、成功toastは追加しない。旧成果物から新成果物への切替も、既存のartifact単位の表示bundleと利用者の更新操作に従う。

## 5. Webの表示・URL契約

節IDは `metric-owner`、目次ラベルは「オーナー」、見出しは「オーナー比較」とする。表示と端末差は [要求仕様5節](requirements/series-owner-comparison.md#5-表示と操作) に従う。

### 共通UIへの接続

- [UI規約](ui-rule.md) を意味・表現の正本、`.interface-design/system.md` を判断の索引、`styles.css` とshared UIを実装値の正本とする。索引の古い値や、隣接する既存componentの見た目だけを新機能の契約にしない。
- 節は既存 `AnalysisSection` と同じ階層・余白を使い、指標は可視ラベルのない `SelectControl` に接続する。accessible nameは「オーナー比較の指標」とし、導入説明文と専用の読み方アコーディオンは置かない。7候補の表示指標選択であり、新たなtab階層・scope filter・独自popupにはしない。URLと指標の意味はfeatureが所有する。
- 比較表は共通 `DataTable` の行・列見出しとacademic tableの表現を使う。番手比較から再利用するのは行＝プレーヤー・列＝条件の読み方と軸ラベルであり、`AnalysisMatrix` の離れたセル、番手の枠・強度・得意苦手の表現を複製しない。
- 通常の表は上端・header下端・最終行下端の横罫線で構成し、外枠・縦罫線・セルごとのcard・通常セルの着色を足さない。headerの文字recipeはshared UIに従う。主要値は `contentText.compactPrimary` とtabular numerals、補助回数・品質は共通の補助表現を使い、名前・操作・全説明まで一律に太字にしない。
- 行見出しは `MemberSequenceLabel`、列はneutralなオーナー名と対象戦数・`SeriesAnalysisQualityAdvisory` を使う。本人がオーナーの対角も通常値とする。列見出しはsort操作を持たず、数値で並び替えない。
- 横移動中もプレーヤーを識別できるよう行見出しを固定する。縦に長くなる順位分布は同じ表領域で列見出しと戦数を追えるようにする。現行 `DataTable` には行見出し固定と名前付きscroll領域の契約が足りないため、必要なopt-inをshared UIへ追加し、既存consumerの既定動作は維持する。
- scroll領域は名前とkeyboardでの到達・離脱を持ち、必要時だけ局所scrollの案内を出す。支援技術にはrow / column headerと品質の対応を伝える。表の高さを制限する場合も画面内に操作可能な領域を確保し、page全体の横scroll、focus trap、sticky見出しによる値の隠蔽を起こさない。
- 順位分布だけは既存の順位tokenによる100% barを併記し、各順位の回数・率は常時文字で読めるようにする。bar内の狭い領域へ文字を詰めず、0回の順位も文字で残す。barと数値で同じ内容を重複して読み上げない。既存 `RankDistributionBars` の強調用 `itemId` や選択試合のringは持ち込まない。
- 見出し・select・表の順で読み、主要値を縮小して全16cellを一画面へ押し込まない。長い名前・金額・順位内訳と、各layout modeの最小幅を実画面で確認する。

### 指標とURL

選択状態はquery parameter `ownerMetric` に保存し、`view=context` と `#metric-owner` で該当節を復元する。指標の値と描画対象は次の7つに限定する。

| `ownerMetric` | selectの表示 | 主表示・補助表示 |
| --- | --- | --- |
| `rank.average` | 平均順位 | `rank.average`、位 |
| `rank.distribution` | 順位分布 | 1〜4位のcount・rate、100%構成 |
| `assets.average` | 平均総資産 | `assets.average`、共通の金額表現 |
| `revenue.average` | 平均物件収益 | `revenue.average`、共通の金額表現 |
| `destination.average` | 目的地到着回数（1試合平均） | `destination.average` 回/試合、合計count回 |
| `ginji.encounterRate` | 銀次遭遇率 | `ginji.encounterRate`、遭遇encounterMatches戦 |
| `ginji.average` | 銀次遭遇回数（1試合平均） | `ginji.average` 回/試合、合計count回 |

- 既定値は `rank.average`。未指定は通知なし、明示した既定値もcanonical URLでは省略する。不正値は既定値へ正規化し、既存の条件補正通知へ「オーナー比較の指標を平均順位に戻しました。」を加える。
- 指標変更は履歴置換とし、現在のscope・view・`focusMatchId`・安全な `returnTo` を保持してfragmentを `metric-owner` にする。その場のselectのfocusと表示位置を保ち、通常の目次クリックによるscroll・focus移動とは区別する。
- 現行navigationは `location.key` とhashの変更を新しいvisitとして節へfocus・scrollするため、単なるreplaceでは上記を満たさない。`useSeriesAnalysisLocationState` と `SeriesAnalysisNavigation` の間に、このページ内の「表示指標だけの変更」という一度限りのintentを渡す。既存location stateを保持したままvisitを引き継ぎ、指標変更・そのcanonical化では節到達処理を再実行しない。任意のURL文字列だけから移動抑止を推測しない。
- intentは発行元のmounted pageがメモリで管理して処理後に消費し、永続した `history.state` のflagだけで移動を抑止しない。URLを別端末で開いた場合・reload・通常の目次移動では通常のfragment移動を使う。POPではそのvisitの保存位置と起点復帰を優先し、位置が失われていれば既存のfragment fallbackに従う。指標selectと表のscroll containerを選択値でremountせず、局所scrollも有効な範囲で保持する。
- intentは「次のlocationなら何でも抑止する」booleanにしない。発行元visit・操作の識別子・正規化後のtargetを結び、該当targetのcommitでだけvisitへ位置保持を引き継ぐ。引継ぎは同じcommitに対して冪等とし、Strict Modeのeffect再実行で到着処理が復活しないようにする。別targetへの移動・POP・unmountでは未適用intentを失効させ、同じ表示変更のcanonical replace以外へ持ち越さない。render中のref/map書換えで適用・消費しない。
- URLは指標の正本とし、表示値・table rows・URLを同期する第二のstate/effectを追加しない。指標変更のsearchとhashは一度のnavigationで確定する。未commitの同一操作系列に続く変更を合成し、古いlocationを前提にしたcanonical化が新しい操作を上書きしないようにする。
- URLのparse・serialize・正規化・状態比較と、作品・scope・view変更処理のすべてに `ownerMetric` を接続する。scope・view変更時に指標を落とさない。選択試合の解除は既存scope変更規則どおりとする。
- 目次移動・ページ往復の履歴は既存のnavigationに委ねる。browser backではその履歴に保存された条件・指標・位置を復元する。URLは表示条件の共有であり、過去の数値を固定するものではない。
- 既存 `formatDecimal`（小数最大2桁）、`formatPercent`（小数最大1桁）、金額formatterをそのまま使う。件数は整数、対象なしは「—」。新しい桁数・数値色・同値の順位づけを導入しない。
- selectのラベルと表のaccessible nameから同じ指標を識別できるようにする。選択直後は同じ保存済み成果物の該当値を表示し、server stateの遅延・取得中状態として扱わない。
- 新aggregateの `metricDefinitions` に `destination.average` と `ginji.average` を追加し、共通の「指標の読み方」に接続する。unitは既存の `count`、labelは上表、`preferredDirection` は `contextual` とし、読み方で対象戦数を分母にした「回/試合」と明示する。owner別分母の補足は既存の開示に置く。表示文言を追加するために `dataQuality` の対象指標を増やさない。
- 共通の読み方は指標の定義を先に示す。既存の銀次遭遇率の説明が求める「遭遇した試合の平均順位・平均資産」など、owner別に提供しない派生値を読むよう誘導しない。共通説明は対象試合に占める割合と平均遭遇回数との違いへ揃え、特定のviewだけにある分布・派生指標の読み方はそのviewの開示に置く。owner比較のためにそれらの指標を新設しない。

## 6. versionとDB変更

versionの意味は [分析バッチ](requirements/series-analysis-batch.md) に従う。調査した現行値と、この変更で採用する値は次のとおり。

| 契約 | 現行 | MOM-3 |
| --- | --- | --- |
| algorithm version | `series-analysis-v4` | `series-analysis-v5` |
| artifact schema version | 2 | 3 |
| validation contract ID | `series-analysis-artifact-v2-full-validation-v1` | `series-analysis-artifact-v3-full-validation-v1` |
| aggregate payload `schemaVersion` | 3 | 4 |
| review / drilldown / match-context payload | 3 / 3 / 1 | 維持 |
| manifest / queue schema | 1 / `"1"` | 維持 |
| publication契約文書の形式 `contractVersion` | 1 | 2（writer pairとreader対応一覧を区別） |
| aggregate HTTP経路 | v2 | 新Webはv3、v2は4節の互換動作 |

入力revisionは保存データの変更で進む値とし、version更新の代わりに全試合を更新しない。旧reader用の生成schema・exact pairもRust所有の互換契約として保持し、別実装で旧shapeを推測しない。

publication契約文書は `series-analysis-publication-contract-v2.json` へ改める。`contractVersion: 2` と、書込み対象を示す既存名の `artifactSchemaVersion` / `validationContractId`、読取り用の `readableContracts`（同じ2フィールドを持つpairの配列）を生成する。MOM-3ではwriterを新pair、reader配列を旧・新の順で2件とする。writer pairがreader一覧に含まれること、重複・未知pairがないことを検証する。現APIは旧文書のフィールド集合を厳密に照合しているため、形式1へフィールドだけを追加しない。

この文書形式の更新は、Rust exporterとfreshness、APIのbuild input・起動時loader、publication契約を読むrelease/control-plane/preemption smokeまで同じ変更に含める。旧raw schemaを読めることと、旧形式の設定文書を新consumerが読むことは別の契約である。新consumerの入口は形式2へ統一し、旧API binaryは元から同梱する旧文書を使う。定義の正本はRustの一つの契約表とし、API・SQLの読取り条件・capability・smokeへ独立したpair一覧を手書きしない。共有DBの制約はDB所有者が同じpairを別途強制し、その一致を実DBで確認する。

共有DBの変更は、momo-dbが既に担う制約・成果物公開とpointerのguard・初期化処理を、新しい成果物形式へ対応させる範囲に限定する。既存のDB側の不変条件は維持する。オーナー別の集計、分母・率・参考値の判定、成果物の意味検証はmomo-resultのRustが所有し、新たな種類の業務判断・不変条件をDB側へ追加・移管しない。migrationの事前条件は安全な移行を確認するためのものであり、通常稼働時の業務判断をDBへ移すものではない。

共有DBでは以下をforward migrationとして実施する。既存migrationファイルは編集しない。

1. release・title・request・job・attempt・campaign・artifactなどの検証契約とschemaの制約へ、新しいexact pair（3と新ID）を追加する。旧pair（2と旧ID）も移行中は保持し、schemaとIDの交差した組合せを許さない。検証前stagingなど、既存でcontract IDが未設定となる状態は保持し、未設定のまま新成果物を公開可能にはしない。
2. 成果物公開とcurrent / previous pointerのguardが、新pairを受け入れるよう更新する。現行migrationのguardは旧schemaと旧IDを明示しているため、worker定数の更新だけでは完了しない。published rowの不変性、検証済みpublication、desiredとの一致など既存のguardを維持する。
3. 新規DB用defaultを新tupleに合わせる。初期singletonの更新を「作品・操作要求が0件」だけで許可しない。新規bootstrapとしてruntime未接続を保証し、作品・操作要求・job・campaign・artifactと、reader / workerの登録履歴がないDBだけを初期化対象にする。registryの確認ではstale / drainingを除外しない。条件確認と更新は同一transactionに閉じ、lock順はDB規約に従う。fresh環境へのruntime接続は初期化完了後とする。稼働履歴があるDBは現在0作品でもactive tupleを保持し、capability確認付きの0-target promotionを使う。
4. siblingで通常DDLとcustom SQLを規約どおり分離し、fresh migrationと旧成果物を持つDBからのupgradeを検証する。実装時に確定したmomo-db commitへ `.momo-db-ref` を更新する。

実装ではmomo-dbの0046〜0049を正規手順で作成・検証し、完了commitへ `.momo-db-ref` を更新した。内訳は実装計画7節に記録する。稼働DBへの適用は行っていない。

## 7. 新旧混在と公開の順序

計画停止を前提にせず、既存のreader-first方式を採る。具体的な本番操作は [公開運用規約](ops/README.md) の境界に従い、この文書で実施済み・承認済みとは扱わない。

1. DBへ旧・新の契約を受け入れる拡張を適用する。旧成果物のpayload・checksum・検証IDをSQLで書き換えない。稼働中DBのsingletonは0作品でもこの段階で新世代へ進めない。fresh bootstrapの条件は6節に従う。
2. APIを旧pair・新pairの両方に対応させ、全resourceの該当validatorを初期化してからcapabilityを登録する。4節の新HTTP経路と旧経路のreload応答を先に用意し、新Webを配置する。
3. 新workerを配置し、対象versionの計算・検証・公開能力を確認する。未対応tupleの仕事は既存規則に従ってclaimせず待機させ、旧契約のまま新payloadを作らない。
4. promotionは全fresh reader / workerのcapabilityをtransaction内で凍結して検証し、release singleton・titleのdesired tuple・campaignを原子的に進める。そのcampaignで過去分も再計算する。
5. 移行中は読める旧成果物を共通の更新状態とともに表示する。失敗時も旧成果物を保ち、owner値を補完しない。新世代では作品内の全scope・全resourceを一緒に検証・公開し、オーナー部分だけを先行公開しない。
6. 各作品の最初の新契約publicationでは、別契約の旧成果物を新契約のpreviousへ繰り上げない。切替までは旧表示を保ち、切替後は既存のpointer・期限切れ回復に従う。新契約で証明されていないpreviousを残さず、旧rowは通常の保持・cleanup規則へ委ねる。
7. 受理したcampaignのtargetの終端と、current / previous・契約・失敗状態の監査で完了を判定する。後続の通常入力更新でqueueが空になることは完了条件にしない。

### capability判定の変更点

現行release処理はreaderにもwriterと同じ単一schema配列を要求するため、そのままでは新旧両対応readerを拒否する。MOM-3のpromotionで許可するreader profileを、**schema配列 `[2, 3]` と対応する旧・新validation IDの配列**（同じ順序）への完全一致と定める。decodeでは2→旧ID、3→新IDのexact pairを検証し、配列の直積を許可しない。

workerは新algorithm・schema 3・新validation IDの単一profileへの完全一致とする。旧のみ、片方のID欠落、未知の追加値、組合せ違いを許容しない。registryの凍結、freshness・draining・登録ゼロの判定は維持する。

今回の提供範囲では新旧両対応readerを維持する。旧decodeの撤去は監査完了と移行後の利用経路を確認した別変更とし、MOM-3公開の必須条件にはしない。rollbackでも新成果物を読める世代を維持し、古い単一世代readerへ無条件に戻したり、desiredを直接書き戻したりしない。

## 8. 実装順序と完了証拠

変更箇所・工程ごとの完了条件・gate・PRのまとめ方は [実装計画](series-owner-comparison-plan.md) に具体化する。本節は必要な証拠の契約を所有し、計画はその実施先と順序を扱う。

実装の依存順は、DB契約の拡張 → 入力・Rust計算・full validator・schema生成 → APIの両世代readとwire生成 → Webの表示・URL → 横断検証と公開準備とする。実際の配置順は7節に従い、計算コードの実装順と混同しない。

| 境界 | 必要な証拠・失敗を検出する点 |
| --- | --- |
| 入力と純粋計算 | 要求仕様の架空例、全scope、件数0/1/2/3、負の資産、目的地0、銀次複数回。入力順を変えても同じ結果。owner訂正で4人全員が移り、親scope指標は不変 |
| 成果物検証 | 16cellの欠落・重複、owner不一致、不正な分母・品質・null・率、checksumへのowner反映。empty scopeと非emptyの対象なしを区別し、不正artifactを公開しない |
| DBとrelease | migrationだけで新契約を受け入れること、旧契約の保持、交差pairの拒否、不変性。fixture変更前のfresh tuple、稼働履歴がある0作品DBのtuple維持と0-target promotion、新規作品のtuple継承、両対応readerのpromotion、未対応profileの拒否、既存の2接続によるregistry凍結証拠 |
| APIとconsumer | 新desired＋旧artifactのstatusとbounded read、新旧のraw / 生成wire decoderを実際の取得経路で確認。v2の426を一般エラーやexpiredへ潰さない。artifact・scope混在と不正pairを拒否。旧schemaの生成・同梱、通知など変更の及ぶconsumerの既存契約を維持 |
| Webの自動証拠 | 7指標と単位、対象なし/観測0/参考値、親scope空、旧成果物のselectと説明、URLの正常・不正・未指定、指標変更の無通信・非inert・focus保持、scope/view変更と選択試合、browser back・期限切れ回復。異なるwire型のcache混在を防ぐ |
| navigationの代表結合経路 | 目次を使わずscrollで到達して指標変更、続けてcanonical化、目次から他節へ移動してback、詳細往復、同じURLを新しく開く。前二者ではfocus・位置保持、移動・再訪では該当するvisit / fragment復元となることを実際のnavigationで確認 |
| 実画面の確認 | Playwright MCPでPC・mobileの代表幅と各layout modeの最小幅を操作する。順位分布・長い名前・負の大きな金額、局所scroll中の名前/戦数、keyboardでの到達・離脱、共通tableとheaderの階層を確認。要求仕様の読解課題を行い、エージェントの実確認と利用者本人の読解証拠を区別して記録 |
| resource | 固定サイズ追加でも既存のbyte/node/入力/出力上限を保つ。分析バッチの規定fixture・連続実行・production runtime境界でworker/API/Webの影響を確認。未計測を性能維持の証明としない |

実装時の必須gateは [Change Gates](dev-rule.md#4-change-gates) のWorker、algorithm version、API、DB、Web API contract、比較の主要UI flowに対応するものを使う。既存証拠を再利用・修正し、同じ数式を全層へ複製したtestや、実装をなぞる専用checkerは追加しない。実装と必要な検証が終わるまでMOM-3の実装完了とは扱わない。

隔離環境で入力・計算・migration・API・Web・代表負荷を検証した。検証量が現在件数の2倍以上という条件は、利用者の回答に基づいて照合済み。本人の読解と本番移行は実装計画7節の残件として明示する。
