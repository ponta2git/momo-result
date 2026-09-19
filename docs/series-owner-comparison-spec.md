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

## 4. HTTP・生成型・consumer

aggregateは `GET /api/analytics/series-comparison/v4/aggregate`、reviewは `/api/analytics/series-comparison/v3/review` を使う。options、status、drilldown、match-contextは既存のv2経路を使う。各resourceは現行の成果物契約だけを受理し、廃止した経路や旧世代のdecoderを残さない。

Rustのresource schemaとTapirのHTTP envelope・metadata projectionからOpenAPIとWeb型・decoderを生成する。APIは起動時に現行validatorを初期化し、artifactのschema・validation contract・resource kind・要求identityを検証する。payloadの自己申告versionだけで検証器を選ばず、無関係な世代とpayloadの組合せを拒否する。

API入力へ `ownerMemberId` や選択指標を加えない。全指標は一度のaggregate読取りに含む。選択指標をresource query keyやscope signatureへ加えず、切替だけでは通信・再計算・取得中の遮蔽を発生させない。

resource取得は共通のread usecase・repository・decode admissionを使い、endpointごとに別の同時実行枠を作らない。rate limit、短いDB transaction、取得からbounded renderまでのpermit、timeout・失敗・cancel後の解放を維持する。requestごとのschema compileや応答JSONの再parseは行わない。

cache identityはruntime data shapeを表す。resource取得・失効回復・明示更新・mutation後の無効化で同じkey factoryを使う。aggregate、review、drilldownは同一artifactへpinし、異なる成果物の値を混ぜない。

### 取得状態とオーナー節

| 状態 | 表示・操作 |
| --- | --- |
| 表示できる成果物がない、または親scopeが0戦 | ページ共通のloading / error / EmptyStateを優先する。オーナー節の空表・別の取得操作は作らない |
| 記録のあるオーナーが1人 | 4列と値を表示し、「この範囲で記録があるオーナーは1人です。」を短く添える |
| 記録のあるオーナーが2人以上 | 通常の4×4比較。対象0戦の列も維持する |
| 更新中・失敗時に直前成功成果物を表示できる | ページ共通の状態表示と「表示を更新」に従い、同じ現行契約の保存済み値を維持する |

旧形式に不足するowner値を合成する表示は設けない。非互換な成果物の切替は7節に従い、公開再開前に再計算する。節固有のspinner、再試行button、成功toastは追加しない。

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
- Webが所有する指標定義に `destination.average` と `ginji.average` を含め、共通の「指標の読み方」に接続する。unitは既存の `count`、labelは上表、`preferredDirection` は `contextual` とし、読み方で対象戦数を分母にした「回/試合」と明示する。owner別分母の補足は既存の開示に置く。表示文言を追加するために `dataQuality` の対象指標を増やさない。
- 共通の読み方は指標の定義を先に示す。既存の銀次遭遇率の説明が求める「遭遇した試合の平均順位・平均資産」など、owner別に提供しない派生値を読むよう誘導しない。共通説明は対象試合に占める割合と平均遭遇回数との違いへ揃え、特定のviewだけにある分布・派生指標の読み方はそのviewの開示に置く。owner比較のためにそれらの指標を新設しない。

## 6. versionとDB境界

現行の計算は `series-analysis-v5`、成果物はartifact 4 / aggregate 5 / review 4 / drilldown 3 / match-context 1である。exact validation contractはRust所有のpublication契約文書から参照し、API・Worker・smokeへ独立した許可一覧を持ち込まない。publication契約文書は現行の `artifactSchemaVersion` / `validationContractId` を一組だけ持ち、読取り用の世代一覧を持たない。

入力revisionは保存データの変更で進む値とし、version更新の代わりに全試合を更新しない。versionを過去のpayloadへ付け替えたり、既存artifactをSQLだけで現行契約の検証済み成果物へ変換したりしない。

共有DBはFK、一意性、検証契約とschemaの整合、published rowの不変性、公開とpointerのguardを担う。オーナー集計、分母・率・品質判定、成果物の意味検証はRustが所有する。旧schema用のアプリコードは維持しないが、保存履歴を守る既存migrationとDB制約は改変しない。必要なDB変更はmomo-dbの正規手順でforward migrationにする。

## 7. 単一世代への切替

仲間内向けサービスとして旧成果物の同時読取りは維持しない。非互換な変更では公開を止め、API・Web・Workerを現行契約へ揃え、既存作品の再計算と監査を終えてから再開する。具体的な本番操作は [公開運用規約](ops/README.md) に従う。

- 復元可能なDB snapshotと対応するimmutable releaseを確保し、旧runtimeを停止する。過去migrationのbaselineや保存payloadを書き換えない。
- APIはvalidator初期化後、Workerは計算・検証・公開能力の準備後に、現行のexact capabilityを登録する。登録ゼロ、期限切れ、別世代を昇格可能としない。
- promotionはregistryをtransaction内で凍結し、release singleton・titleのdesired tuple・campaignを原子的に進める。対象全作品の再計算は同じcampaignで追跡する。試合0件の作品を含め、未対応の成果物pointerを現行の参照として残さない。
- 成果物は作品内の全scope・全resourceを一緒に検証・公開する。別契約の旧currentをpreviousへ繰り上げず、参照されなくなった旧rowは通常の保持・cleanupへ委ねる。
- campaign完了、current / previousのexact契約、runtime世代、失敗状態を監査して公開を再開する。切り戻しでは公開停止中にDBとreleaseを整合する組合せへ戻す。

## 8. 実装順序と完了証拠

変更箇所・工程ごとの完了条件・gate・PRのまとめ方は [実装計画](series-owner-comparison-plan.md) に具体化する。本節は必要な証拠の契約を所有し、計画はその実施先と順序を扱う。

実装の依存順は、DB契約の拡張 → 入力・Rust計算・full validator・schema生成 → APIの現行readとwire生成 → Webの表示・URL → 横断検証と公開準備とする。実際の配置順は7節に従い、計算コードの実装順と混同しない。

| 境界 | 必要な証拠・失敗を検出する点 |
| --- | --- |
| 入力と純粋計算 | 要求仕様の架空例、全scope、件数0/1/2/3、負の資産、目的地0、銀次複数回。入力順を変えても同じ結果。owner訂正で4人全員が移り、親scope指標は不変 |
| 成果物検証 | 16cellの欠落・重複、owner不一致、不正な分母・品質・null・率、checksumへのowner反映。empty scopeと非emptyの対象なしを区別し、不正artifactを公開しない |
| DBとrelease | migration後の保存データ保全、交差pair拒否、不変性、fresh tupleと新規作品の継承、現行capabilityのpromotion、別世代拒否、2接続でのregistry凍結、再計算後の参照収束 |
| APIとconsumer | 現行成果物のstatusとbounded read、raw / 生成wire decoder、旧・未知契約とartifact・scope混在の拒否。削除したHTTP経路の不在と現行schemaの生成・同梱 |
| Webの自動証拠 | 7指標と単位、対象なし/観測0/参考値、親scope空、URLの正常・不正・未指定、指標変更の無通信・非inert・focus保持、scope/view変更と選択試合、browser back・期限切れ回復 |
| navigationの代表結合経路 | 目次を使わずscrollで到達して指標変更、続けてcanonical化、目次から他節へ移動してback、詳細往復、同じURLを新しく開く。前二者ではfocus・位置保持、移動・再訪では該当するvisit / fragment復元となることを実際のnavigationで確認 |
| 実画面の確認 | Playwright MCPでPC・mobileの代表幅と各layout modeの最小幅を操作する。順位分布・長い名前・負の大きな金額、局所scroll中の名前/戦数、keyboardでの到達・離脱、共通tableとheaderの階層を確認。要求仕様の読解課題を行い、エージェントの実確認と利用者本人の読解証拠を区別して記録 |
| resource | 固定サイズ追加でも既存のbyte/node/入力/出力上限を保つ。分析バッチの規定fixture・連続実行・production runtime境界でworker/API/Webの影響を確認。未計測を性能維持の証明としない |

実装時の必須gateは [Change Gates](dev-rule.md#4-change-gates) のWorker、algorithm version、API、DB、Web API contract、比較の主要UI flowに対応するものを使う。既存証拠を再利用・修正し、同じ数式を全層へ複製したtestや、実装をなぞる専用checkerは追加しない。実装と必要な検証が終わるまでMOM-3の実装完了とは扱わない。

隔離環境で入力・計算・migration・API・Web・代表負荷を検証した。検証量が現在件数の2倍以上という条件は、利用者の回答に基づいて照合済み。本人の読解と本番移行は実装計画7節の残件として明示する。
