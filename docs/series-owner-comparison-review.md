# Design Review: MOM-3 オーナー別戦績比較

履歴注記（2026-09-19）: 本書は当時の計画・レビュー記録。利用者の判断により世代互換コードは撤去した。現行の契約と単一世代への切替方針は [実装仕様](series-owner-comparison-spec.md) と [分析バッチ](requirements/series-analysis-batch.md) を参照する。

2026-09-18追記: 実装と隔離環境での受入を実施した。R1〜R5・S1〜S7・K1〜K8の実装対応と検証は [実装計画7節](series-owner-comparison-plan.md) に記録する。計算はRust、DBは既存guardと初期化の拡張、APIは両世代のbounded read、Webは既存の条件別・共通UIへ接続した。検証量が現在件数の2倍以上という条件は利用者の回答に基づいて照合済み。利用者本人の読解と本番移行は未完了。以下の点数・NOT DONE判定は2026-09-17の計画レビュー当時の記録であり、今回の実装採点ではない。

**Verdict:** NOT DONE（実装・出荷の診断。要求のレビューと改訂は完了。score 4/10は文書から確認できた3/7項目の換算であり、製品の使いやすさを実測した点数ではない）

**The One Thing:** オーナー別に4人の記録を気軽に見比べ、仲間内で話のネタにする。

**Keeps its promise?** 追加3問の回答を反映し、要求を改訂した。価値は仲間内の話のネタ、利用場面は各自の端末を見ながらDiscord越しに話すことと明確になった。過去のオーナー記録は実態に合わせて入力しているとの回答を得た。1指標ずつの一覧、URLからの条件・指標復元、共通の名前・並び順・最終更新を要求に加えた。実画面での読みやすさは未検証である。

**Steps to value:** 比較ページから「分析する」→「条件別」→オーナーの目次へ進む想定は3操作。URLを受け取った人は条件と指標を復元できる要求とした。ただし、会話に使う値・件数を読み取るまでの操作・読解は未確認。section到達を価値到達と数えない。

**Cut list:** 対象試合一覧、全体owner filter、高度分析の追加を解決策として戻さない。率・平均とその分子・合計をすべて同じ強さで主表示する案、画面に16cellを置けたことを完了とする評価、平均順位が最優先だという未確認の前提を取り除く。

**Fix list:** 下記R1〜R5、5節のS1〜S7、6節のK1〜K8。要求の価値・UI統合、実装仕様の移行契約、実装計画の性能・保守性・framework接続を改訂した。実装後は、別端末で同じ条件・指標を見ながら値と件数を読み取れるかを確認する。補正・検定機能を増やして会話の手軽さを失わない。

**Back of the fence:** 記録のあるオーナーが1人だけ、3試合が同じ開催に集中、同値ばかり、対象なしと0回が隣接、条件変更で件数が大きく減る、古い成果物しかない場面を確認する。

**Next review:** 画面実装後に、下記の読解課題をPC・mobileと別端末での利用で確認する。今回の依頼は計画のレビューなので、未実装を理由に要求改訂を止めたり、実装済みと評価したりしない。

対象は [要求仕様](requirements/series-owner-comparison.md)。2026-09-17時点の文書と関連コードをレビューした。以下は初稿への指摘と、追加回答を受けた対応記録である。確定済みの対象指標・一覧比較・4人表示・対象試合一覧なしの範囲は維持した。新機能の実画面・実データを使った評価は行っていない。

後続の規約・実装調査を踏まえ、[実装仕様](series-owner-comparison-spec.md) を確定した。成果物構造、URLの指標値、新旧互換、共有DB変更の要否と完了証拠を具体化している。この確定は、上記の未実装・実画面未検証という出荷評価を変更するものではない。

既存画面への融合についての追加レビューは4節にまとめた。要求5節と受入条件へ反映済みであり、前節までの提供価値を維持して、軸・操作・文言・状態の接続を具体化している。

## 1. 初稿への指摘と反映

### R1 高: 集計の提供と、利用者の疑問の解消がまだつながっていない

- **箇所:** 要求仕様1節「成功条件」、4節「初版の指標」、5節「平均順位を入口」。
- **根拠:** 利用者が選んだのは順位・資産・収益・目的地・銀次という対象分野。平均順位を先頭にすること、金額は平均だけで十分なことは策定側の具体化であり、具体的な利用場面から確かめていない。
- **壊れ方:** 本当に知りたいことが「誰のオーナー時に銀次が多いか」なら、順位から大量の数値を読む流れは初回の価値到達を遅らせる。「普段の印象を皆で話す」ことが目的なら、次戦の意思決定まで要求するのも誤りになる。
- **修正方向:** 実際に出る疑問を1つ確認し、初期指標・読み順・受入時の読解課題へ反映する。戦略の変更、仮説の検証、会話の楽しさのいずれが価値かを勝手に限定しない。
- **回答と反映:** 利用者は「話のネタになれば良い」と回答。明確な差や作戦の発見を完了条件にせず、近い値・同値も会話の材料として扱う要求へ修正した。平均順位は共通理解のある初期値として残し、価値の中心とは位置づけない。これは研究・意思決定を当然の価値と見なしかけたレビュー側の前提も修正する回答である。

### R2 当初は高・回答で解消: 保存済みオーナーを信頼できる入力とみなしている

- **箇所:** 要求仕様3節「現在保存されているオーナー」、6節「過去試合も再集計」。
- **根拠:** [OCR初期値](../apps/web/src/features/ocrCapture/schema.ts) が [ページ初期化](../apps/web/src/features/ocrCapture/useOcrCapturePageModel.ts) に入り、[手入力フォーム](../apps/web/src/features/matches/workspace/matchFormTypes.ts) も既定のオーナーで始まる。必須入力の検証は、利用者が実際のオーナーを確認して選んだことまでは証明しない。
- **壊れ方:** 実際のオーナーと違う初期値が残っている場合、計算が正確でも入力時の習慣を可視化してしまう。逆に、毎回正しく入力しているなら、新たな確認操作やデータ品質機能を追加する必要はない。
- **修正方向:** 過去記録の入力実態を確認する。正しく入力されているという回答があれば、この仮説は解消する。誤記録の存在、件数、補正方法をコードだけから断定しない。
- **回答と反映:** 利用者は「複数人の記録があり、実際のオーナーに合わせて入力している」と回答。保存済みオーナーを使う前提を維持し、追加の入力確認・補正機能は不要と判断した。DBの実データを照合した証拠ではないことは要求仕様9節に残した。

### R3 中: 同じfilterの内側でも、オーナーごとの条件構成は一致しない

- **箇所:** 要求仕様1節「同じ作品・シーズン・マップ条件」、4節の平均と率、5節の比較条件表示。
- **根拠:** シーズン・マップは任意filterであり、指定しなければ複数条件が混在する。同じ親scopeを使うことは、各オーナーが同じ割合で各条件を遊んだことを意味しない。
- **壊れ方:** 下記の架空例では、各マップではAのオーナー時に良い順位でも、総合ではBが良く見える。両者100試合なので、試合数だけでは見抜けない。
- **修正方向:** オーナーの効果ではなく選択範囲の記録比較であることを要求上明確にする。条件の偏りを知るために何を表示するかは、利用目的と実際の偏りに合わせて決める。補正モデル、期間filter、巨大な条件内訳を一律に追加しない。
- **回答を踏まえた扱い:** 話のネタを得る目的なので、補正モデルや検定は追加しない。選択範囲・件数・参考表示を短く伝え、記録比較からゲームの公平性を断定しない要求にする。逆転例は設計の点検に使い、利用者に統計の読解を要求しない。

| 対象 | Aがオーナーの試合数 | 同じプレーヤーの平均順位 | Bがオーナーの試合数 | 同じプレーヤーの平均順位 |
| --- | --- | --- | --- | --- |
| マップX | 80 | 2.4 | 20 | 2.8 |
| マップY | 20 | 1.4 | 80 | 1.8 |
| 総合 | 100 | 2.2 | 100 | 2.0 |

この例は説明用の架空データである。総合平均は各試合を同じ重みで集計した正しい数値だが、それだけでオーナーの有利不利を判断することはできない。

### R4 中: 4×4の一覧を置くことが、4×4を読めることに置き換わっている

- **箇所:** 要求仕様5節「表示と操作」、受入条件AC5。
- **根拠:** 7行の指標定義があり、順位分布や銀次の回数には複数の値がある。単純に全指標を展開すれば、16組それぞれの数字を大量に走査する構成になる。具体的な構成や実画面はまだないため、現行UIが読みづらいという観測結果ではなく、要求が許してしまう実装上の問題である。
- **壊れ方:** mobileで行・列見出しを往復し、名前と数値を記憶しないと読めない。小さな文字にすれば全項目が収まるが、比較する負担は減らない。
- **修正方向:** 見たいプレーヤー・指標に着目したまま4人のオーナーを読めることを受入条件にする。全員・全指標の同時展開を必須にしない。率・平均を主役にし、分子や合計は検算・解釈の補助とする。
- **回答と反映:** 利用者は「それぞれがそれぞれの端末を見ながらDiscordごしにはなす」と回答。端末の種類は限定せず、1指標ずつ4×4の一覧を切り替え、PC・mobileで指標名・名前の順序・値・分母を揃える要求とした。条件・指標・オーナー比較への到達をURLから復元し、最終更新も確認できるようにする。値・分母の読解課題と別端末での復元をAC5・AC5aへ反映した。Discord連携や端末間の自動同期は追加しない。

### R5 中: 比較が成立しないデータでも、完成した比較表に見える

- **箇所:** 要求仕様4節の件数と品質、5節の対象なし、受入条件AC3。
- **根拠:** 各オーナーの0件表示は決まっているが、記録のあるオーナーが1人だけの場合の「オーナー間では比較できない」という全体の状態を扱っていない。同値のみのケースも読解の受入条件にない。
- **壊れ方:** 大きな空表を見せただけで「オーナー差を見られた」と完了判定できる。記録がある人だけを暗黙の最良オーナーとして読ませる可能性も残る。
- **修正方向:** 4人の枠と実在する数値を維持しつつ、比較相手がいない状態を簡潔に示す。同値なら観測値が同じと読み取れることを確認し、差や順位づけを作らない。3試合以上という既存境界を、比較が成立・安定したことの意味に広げない。
- **状態:** 単一オーナーの表示状態と、同値・対象0件を区別する読解課題を要求へ反映した。既存の0件・参考表示の決定は維持した。

## 2. 読解で確認すること

実装後のmanual reviewでは、数値が表示されることに加え、次の問いに画面だけで答えられるかを確かめる。新しい自動testを各行に一つずつ追加する一覧ではない。

- 指定したプレーヤーの指定した指標について、オーナーA・Bそれぞれの値と試合数を特定できる。
- 銀次の「遭遇率」と「1試合あたり回数」を取り違えず、同じ平均回数でも遭遇する試合の割合が異なるケースを読める。
- 0試合と、試合はあるが目的地・銀次が0回だった場合を区別できる。
- 記録が1オーナーだけの場合は比較相手がいないと分かり、同値の場合は観測値が同じと分かる。
- 任意条件を指定していない総合を、条件を揃えて検証した結果だと誤解させない。
- PC・mobileとも、オーナー名とプレーヤー名を取り違えず同じ問いに答えられる。
- 別端末でURLを開き、作品・条件・指標を復元して同じプレーヤーの値と件数を特定できる。値が違う場合は、条件・指標・最終更新を確認できる。
- 差が小さい結果や同値も、そのまま会話に使える。差の発見や作戦変更を達成条件にしない。

代表データは意味のある差、同値、偏った件数、単一オーナー、対象0件、少数例を含む。架空の例での算術確認、エージェントの表示確認、利用者の読解確認を別の証拠として扱う。

## 3. 出荷診断の根拠

使用した `steve-jobs-design-review` スキルの7項目を、要求文書で確認できる範囲と未検証に分けたもの。

| 診断 | 今回の評価 |
| --- | --- |
| 一文で目的を言える | 文書と回答で確認。価値は仲間内の会話の材料 |
| 3操作以内に価値へ到達 | 未確認。3操作でsectionへ到達する想定と、疑問の解消を分ける |
| 説明なしに製品を使った | 未検証。新機能は未実装 |
| 実機で動くdemoがある | 未検証。今回の対象は計画 |
| 不要なものを削った | 範囲として確認。全体filter・対象試合一覧・高度分析を追加せず、主表示の重複も除く |
| 空・失敗・境界を扱う | 文書で確認。読み取り・更新・対象なしの契約に加え、R5の単一オーナー・同値の読解面を補強した |
| 日常で使いたくなることを確認した | 未検証。意図する価値は回答で確認したが、実画面での確認はしていない |

文書上の確認3件をスキルの換算で4/10とした。実機未検証を製品の失敗と断定せず、要求改訂の完了を出荷品質の合格とも扱わない。

## 4. 既存の戦績比較との整合レビュー

2026-09-17に、要求を現行の表示・操作経路と照合した。`interface-design` スキルは既存システムへの一貫性の確認に使い、UIの正本は [UI規約](ui-rule.md)、画面の正本は [戦績比較](requirements/series-comparison.md) とした。実画面の描画・操作の確認は行っていない。

結論: 「条件別」へ加える方針は既存の構成に合うが、前稿には表の軸、参考の呼称、全体0戦の扱いに不整合があった。指標選択とURL復元は必要な追加として残し、既存の共通操作へ接続する要求に改訂した。

| 観点 | 現行の根拠と前稿の問題 | 反映した判断 |
| --- | --- | --- |
| 配置と階層 | [ContextView](../apps/web/src/features/seriesComparison/page/SeriesAnalysisContextView.tsx) は目次と同格の節を縦に読む。前稿は「条件別」内の順序・階層が未定義 | 「番手比較」の次へ「オーナー比較」を置く。同じsurface・節見出し・目次を使う |
| 表の軸 | [番手比較](../apps/web/src/features/seriesComparison/charts/SeriesAnalysisContextCharts.tsx) は行＝プレーヤー、列＝番手。前稿の行＝オーナーでは隣の条件比較と読み方が逆になる | 行＝プレーヤー、列＝オーナーへ変更。件数・品質はオーナー列に対応させる。第n試合傾向には別の向きもあるため、全表に共通の軸と誤認しない |
| 名前と判定 | 両軸に同じ4名が出る。[直接対決表](../apps/web/src/features/seriesComparison/charts/SeriesAnalysisOverviewCharts.tsx) は本人の対角を除外し、番手比較は得意・苦手を示す | 行列の役割を明示し、本人がオーナーのcellも通常の集計値を出す。表の基本構造を再利用しても、別指標の判定や除外を持ち込まない |
| 指標切替 | [navigation](../apps/web/src/features/seriesComparison/page/SeriesComparisonAnalysisNavigation.tsx) は目的・切り口の2階層tabと節の目次を持つ。前稿は1指標表示の操作が未定義 | 7指標は節内の共通selectで選ぶ。現在値を指標名の表示とし、3階層目のtabや同義の見出しを追加しない |
| 数字と品質 | [formatter](../apps/web/src/features/seriesComparison/model/seriesAnalysisPresentation.ts) と [品質表示](../apps/web/src/features/seriesComparison/SeriesAnalysisQualityAdvisory.tsx) は「—」「参考値」「対象なし」を使う。前稿は「参考」とだけ記載 | 共通の金額・小数・率・未定義値の書式を使い、戦数と回数を区別する。順位分布は既存の構成比と数値併記に合わせる |
| 共通範囲の表示 | [ScopeBar](../apps/web/src/features/seriesComparison/page/SeriesAnalysisScopeBar.tsx) が作品・戦数・非既定条件・最終更新・表示更新を所有する。前稿はオーナー節内への再掲も許す | 共通表示を再利用し、オーナー節では列ごとの戦数・品質だけを加える。既定条件は既存の選択欄で確認する |
| 全体0戦 | [比較ページ](../apps/web/src/features/seriesComparison/page/SeriesComparisonPage.tsx) は全体0戦で分析本文を共通の空状態に置換する。前稿の全員0戦表はこの分岐と競合 | 親scopeに試合がある表では0戦のオーナー列も維持し、親scope全体が0戦なら共通の空状態・回復導線を使う |
| URLと移動 | [URL管理](../apps/web/src/features/seriesComparison/navigation/useSeriesAnalysisLocationState.ts) は既知の状態を正規化し、[節移動](../apps/web/src/features/seriesComparison/navigation/SeriesAnalysisNavigation.tsx) はfragmentと遅延描画後のfocus・戻り位置を扱う。指標の状態はまだない | 既存管理へ指標を追加し、節到達はfragmentを使う。選択試合・安全な戻り先を維持し、指標操作中のfocus・位置とURLからの節到達を区別する |

mobileについて、親要求の「1人ずつの読解」は全員の値を一画面へ詰め込む要求ではない。既存matrixと同じく横方向の条件対応を保ち、1人の行を追えること、名前・分母を確認できることを受入条件にした。全体の操作体系・指標範囲・再集計方式は増やしていない。

実装後は、番手比較からオーナー比較へ続けて読む課題、共通の参考値・数値表現、全体0戦と一部オーナー0戦、目次・指標変更・戻る操作の組合せを代表状態で確認する。要求文書の整合が取れたことと、実画面で自然に使えることの証拠は分ける。

## 5. 実装仕様の敵対的レビュー

2026-09-17。[実装仕様](series-owner-comparison-spec.md) を現行の実行経路、デザインシステム、ドメイン・構造・DB・UI・品質規約に照らしてレビューした。以下は**実装仕様の不足と、それにより許される失敗**であり、未実装のMOM-3が既に障害を起こしているという報告ではない。全7件を文書へ反映した。修正後の実装・DB・実画面の証拠はまだない。

### S1 高: 0作品の稼働DBをfresh DBと取り違えられる

- **箇所:** 実装仕様6節の初期tuple、7節の移行順。
- **根拠:** 旧 `0040_initialize-empty-series-analysis-v4.sql` は作品・操作要求がないことを初期化条件にしている。その変更は同一artifact契約内のalgorithm更新だった。今回のschema・validation ID変更へ同じ条件だけを移すと、稼働中の空DBでもreader確認前に新世代へ進められる。[DB規約](db-rule.md) は不可分なtupleとcapability確認付きpromotionを要求する。
- **壊れ方:** 旧API・workerが稼働する0作品DBでmigrationを先に適用し、その間に作られた作品が未対応tupleを継承する。reader-firstの順序を守ったつもりでも、新しい作品の分析を扱えなくなる。
- **反映:** fresh bootstrapはruntime未接続と登録履歴・分析状態の不存在を条件とする。稼働履歴のある0作品DBはtupleを保持し、通常の0-target promotionへ進める。fresh baselineの検証と、稼働履歴のある空DBの検証を分けた。

### S2 高: 両対応をschema追加だけで完了させられる

- **箇所:** 実装仕様4節のreader対応、6〜7節の旧契約保持。
- **根拠:** [status](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresSeriesAnalysisReadOps.scala) はdesiredと表示artifactの双方を検証する。[chunk SQL](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresSeriesAnalysisChunkOps.scala) は旧pairへ固定され、[raw validator](../apps/api/src/main/scala/momo/api/adapters/postgres/SeriesAnalysisPayloadValidator.scala) はresource kindから単一schemaを選ぶ。[API build](../apps/api/build.sbt) も同梱schemaを列挙している。
- **壊れ方:** capabilityだけ新旧対応にしても、旧artifactがSQLで選べずexpiredになる、逆に新payloadが旧validatorで落ちる、buildに旧schemaが入らず起動できない。旧Webに426を返す前に一般エラーにもなり得る。
- **反映:** allowlist・status・同一snapshotのbounded read・raw validator・HTTP/decoder・schema生成と同梱を対応表にした。新desired＋旧成功artifact、正しい旧/新pairと交差pair、v2の426を実際の取得経路で確認する。旧schemaを残骸として配る方式は採らない。

### S3 高: 指標変更のreplaceでfocusと読んでいる位置を失う

- **箇所:** 実装仕様5節のURL変更と位置保持。
- **根拠:** [LocationState](../apps/web/src/features/seriesComparison/navigation/useSeriesAnalysisLocationState.ts) のreplaceはlocationを更新する。[Navigation](../apps/web/src/features/seriesComparison/navigation/SeriesAnalysisNavigation.tsx) は `location.key` とhashをvisitのキーとし、未処理visitでは節見出しへfocus・scrollする。前稿の「区別する」という結果だけでは接続方法が不足していた。
- **壊れ方:** scrollでオーナー表まで進んで指標を変えると、selectから見出しへfocusが移る。hashを付けない回避では、共有URLから該当節へ着けない。
- **反映:** 既存navigationへ一度限りの表示変更intentを渡し、そのvisitと局所scrollを維持する。intentは消費し、reload・別端末・目次・POPの復元を抑止しない。canonical化を含む連続操作を検証境界に追加した。

### S4 中: 指標をkeyへ入れないことと、wire型を区別しないことが混ざっている

- **箇所:** 実装仕様4節のAPI・cache、5節のURL。
- **根拠:** [構造規約](architecture.md) はruntime data shapeをquery keyで区別する。[現在のkey](../apps/web/src/shared/api/queryKeys.ts) はaggregateを含むartifact系のprefixを共有する。前稿はownerMetricを入れない点だけを指定していた。
- **壊れ方:** 新旧aggregate型を同じkeyで扱う、または共通prefixの一括改番で無関係なresourceの無効化・失効回復の対応を落とす。
- **反映:** aggregateのwire型だけを区別し、共通artifact prefixによる無効化を保つ。取得・回復・更新で同じkey factoryを使う。ownerMetricはscope signatureにも含めず、選択で通信やinertを発生させない。

### S5 中: 「番手比較に合わせる」が別の表の装飾まで流用する指示になる

- **箇所:** 実装仕様5節、デザインシステムの索引。
- **根拠:** [番手比較](../apps/web/src/features/seriesComparison/charts/SeriesAnalysisContextCharts.tsx) と [AnalysisMatrix](../apps/web/src/features/seriesComparison/charts/SeriesAnalysisMatrix.tsx) は条件の強度を表す離れたセル・枠・塗りを使う。通常の値を並べる [DataTable](../apps/web/src/shared/ui/data/DataTable.tsx) とは役割が異なる。また `.interface-design/system.md` のheaderのsemibold指定は、[UI規約](ui-rule.md) と現在の共通header recipeに一致していなかった。
- **壊れ方:** 4×4の各値が小さなcardとなり、存在しない優劣や操作性を感じさせる。単に横scroll可能にしてもプレーヤー名を見失い、順位分布を読む途中でオーナーと対象戦数が分からなくなる。
- **反映:** 行列の読み方は継承し、表示はacademic tableへ接続する。必要な行見出し固定・名前付きscroll領域はshared UIのopt-inとし、keyboard・長い値・狭幅を確認する。索引の太字指定も正本へ合わせた。既存の番手表・他のmatrix全体の改修には拡張しない。

### S6 中: 旧成果物・単一オーナー時の操作と説明が曖昧

- **箇所:** 実装仕様4節、要求仕様5節。
- **根拠:** 前稿は旧成果物の説明文を指定したが、指標selectを操作可能にするかを決めていなかった。「比較相手がいない」という説明も、4人のプレーヤーがいる状態と混同できる。[UI規約](ui-rule.md) はdisabledの理由と状態の影響範囲を要求する。
- **壊れ方:** 表示されない値のselectを操作し続ける、旧成果物を全0戦と見る、4人の記録が不足していると思う。
- **反映:** 親scope空・旧aggregate・新aggregate・更新失敗を状態表で分けた。旧selectは現在値を保持して理由付きdisabled、記録が1ownerならその事実だけを伝える。desiredではなく表示中artifactで分岐し、局所の更新操作を増やさない。

### S7 中: 共通ヘルプがowner比較にない派生指標を読むよう求める

- **箇所:** 実装仕様5節の「指標の読み方」。
- **根拠:** [現行の読み方](../apps/web/src/features/seriesComparison/page/SeriesAnalysisViewPrimitives.tsx) は銀次遭遇率から「遭遇した試合の平均順位と平均資産」を読むよう誘導する。MOM-3はowner別のその派生値を提供しない。資産の分布などもowner比較の範囲外である。
- **壊れ方:** owner全試合の平均を銀次遭遇試合だけの平均と誤読する、説明を満たすためだけに新指標・新画面を追加する。
- **反映:** 共通ヘルプは定義・分母・単位へ揃え、view固有の派生指標への誘導はそのviewの開示へ置く。ownerの提供指標は7種類のままとした。

### 修正後の判断

- 提供価値と初版の機能範囲は維持した。局所の独自表・popup、owner用更新操作、ヘルプのための新しい集計、全HTTP経路の改番は追加しない。
- 仕様上の指摘S1〜S7は反映済み。実装仕様8節に、各失敗を観測する最小の境界を割り当てた。同じ数式を全層へ写す検証は要求しない。
- 実装前レビューとして進められる状態である。出荷判定は冒頭のNOT DONEのままとし、既存コードの読取りを新画面の実操作・DB移行・性能の検証へ読み替えない。

## 6. 実装計画の技術レビュー

2026-09-17。[実装計画](series-owner-comparison-plan.md) を実装規約、frameworkの公式資料、ISO/IEC 25010の性能効率性・保守性の観点で再評価した。**高6件・中2件を計画と実装仕様へ反映済み。実装・測定による解消確認は未実施。** 以下は計画に残っていた破綻条件であり、本番で観測した不具合ではない。

### 評価の基準と資料の適用範囲

[ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) を採用する。2011版の8特性を現行版として扱わない。公開されている規格資料の製品品質モデルを設計へ適用するもので、規格全文の適合監査や認証ではない。性能は時間・資源・容量を分け、保守性は変更する人が責務・影響・失敗原因・試験方法を追えるかに具体化した。規格の定義をアプリ固有の数値閾値へ読み替えない。[規格の公開サンプル](https://standards.iteh.ai/catalog/standards/iso/8c5bd63e-9e67-4b55-90e3-8cb2b10a2030/iso-iec-25010-2023)

対象実装はlockfile上のReact 19.2.8、React Router 7.18.3、TanStack Query 5.102.8と、API build上のCats Effect 3.7.0。実appは `createBrowserRouter` / `RouterProvider` とStrict Modeを使う。Context7で取得した公式資料を現行の呼出し方と照合し、Routerについてはinstalled 7.18.3のsetter実装も確認した。最新版の別majorへの移行を解決策に含めない。

内部の判断基準は [構造規約](architecture.md)、[テスト・品質規約](test-rule.md)、[Change Gates](dev-rule.md#4-change-gates)、[UI規約](ui-rule.md)、[分析バッチのresource・互換性契約](requirements/series-analysis-batch.md) とした。

### K1 高: 「計算規則の再利用」が不要な分析と配列の再生成を許していた

- **根拠:** 計画P2は再利用の粒度を定めていなかった。現行の [player_metrics](../apps/processing-worker/crates/analysis-core/src/compute/metrics.rs) は順位・金額vectorや条件別subsetを作り、中央値なども計算する。[ScopeAnalysis](../apps/processing-worker/crates/analysis-core/src/compute.rs) の作り直しには高度分析も含まれる。
- **壊れ方:** ownerで切った入力を既存の集計へ渡すだけで、必要な7指標を超える処理・sort・allocationが増える。「出力は16cellだから軽い」という説明では防げない。
- **反映:** 実装仕様1節とP2で、正規化済み入力の一度の走査と固定accumulatorへ限定した。共有対象は数値変換・率・品質などの小さな規則。全分析ではなくowner集計増分の計算量と作業領域を明記した。
- **証拠:** 手計算・入力順不変・件数境界に加え、同じscope構成で入力を増やしたときの追加時間/メモリを確認する。内部関数の呼出し回数を固定するtestで性能を代用しない。

### K2 高: 性能測定が最終工程に偏り、合否と診断の区別が弱かった

- **根拠:** 旧計画P6には測定対象があったが、変更前の基準・条件・上限との対応をいつ確定するかがなかった。分析バッチは全有効scope、規定fixture、連続実行、各processの上限を要求する。
- **壊れ方:** UIと移行実装が終わってからbyte/node上限への余裕不足が判明する。平均的な一つのscopeだけで測り、多scope時の出力増加や新旧同時読取りを見逃す。測定しただけで合格になる。
- **反映:** 計画2節で実装前の基準を固定し、P2/P3の代表差分、P6の最終resource evidenceへ分けた。4節には時間・資源・容量の受入条件を置き、入力owner追加とscope単位のpayload増加を分けた。
- **証拠:** 既存上限・応答要求がblocking、前後差とばらつきは原因分析の証拠。根拠のない「増加率何%まで」やISO由来を装った閾値は作らない。運用の実測値を公開文書へ出さない。

### K3 高: URL更新を複数のsetter/effectへ分けると後続操作を失う

- **根拠:** [LocationState](../apps/web/src/features/seriesComparison/navigation/useSeriesAnalysisLocationState.ts) は利用者操作の更新とcanonical化を持つ。Routerのsearch params setterはReactのstate setterのように同一tickのcallbackを累積しない。これは公式説明とinstalled versionの実装で確認した。[React Router公式資料](https://reactrouter.com/api/hooks/useSearchParams)
- **壊れ方:** 指標変更のsearch、節のhash、正規化を別々に更新し、古いstateが新しいscopeや指標を上書きする。effectでselectのlocal stateとURLを相互同期すると、競合する正本が増える。
- **反映:** P4で一度のnavigationにsearch/hash/stateをまとめる。同じ操作系列の未commit targetに続く変更を合成し、古いcanonical化の適用を防ぐ。URLと表示bundleから選択値・rowsを導出し、第二の同期stateを作らない。これはReactの導出stateを重複保持しない原則とも整合する。[React公式資料](https://react.dev/learn/you-might-not-need-an-effect)
- **証拠:** 指標の連続変更、指標→scopeの変更、canonical化、POP、遅い応答を実際のData Routerで通し、最終URL・選択値・表示artifactの一致を確認する。

### K4 高: 一度だけ消費するintentはStrict Modeと取消に対する契約が不足していた

- **根拠:** [Navigation](../apps/web/src/features/seriesComparison/navigation/SeriesAnalysisNavigation.tsx) の `Visit.begin()` はhandledを戻す。旧計画は「完了後に消費」とだけ定め、targetの照合やeffect再実行を扱わなかった。Strict Modeではeffectのsetup/cleanupが追加実行される。[React公式資料](https://react.dev/reference/react/StrictMode)
- **壊れ方:** 最初のeffectでintentを消費した後に到着処理が復活する。また、未適用intentが別の目次移動やbackを抑止する。global booleanや永続history flagでは表示変更と再訪を区別できない。
- **反映:** source visit・操作ID・targetを結ぶpage内intentとし、commitしたtargetのvisitへ冪等に引き継ぐ。別target/POP/unmountで未適用分を失効させる。render中に副作用を起こさず、既存のbounded visit管理へ閉じる。`preventScrollReset`をcustom到着処理の代用品にしない。
- **証拠:** Strict Modeと実shared Selectを使い、focus・window/局所scroll・履歴を確認する。effectやnavigateの単なる呼出し回数をoracleにしない。

### K5 高: 新旧APIで資源枠やdecode pipelineを分ける余地があった

- **根拠:** [既存repository](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresSeriesAnalysisRepository.scala) は一つのpermitで取得からrenderを囲み、DB接続はJSON処理より前に解放する。P3の「既存方針を維持」だけでは、endpoint追加時の別instanceやresponse再parseを防げない。
- **壊れ方:** 各endpointで同じ数のpermitを作って実効同時実行数を倍にする。schemaを毎requestで初期化する、旧・新を順番に検証する、426判定のためにJSONをdecodeし直す。timeout/cancel時のpermit解放漏れも後続読取りを止める。
- **反映:** v2/v3のusecase・repository・admission共有、起動時validator初期化、metadataによる426判定を実装仕様4節とP3へ追加した。Cats Effectのresource scopeによる管理を維持し、新しいthread poolや無制限並列化を加えない。[Cats EffectのSemaphore](https://typelevel.org/cats-effect/docs/std/semaphore)、[高負荷処理の制御](https://typelevel.org/cats-effect/docs/core/starvation-and-tuning)
- **証拠:** 新旧混在での共通上限と、失敗/timeout/cancel後の次の取得を確認する。配備成功や単発の正常応答を資源保証の証拠にしない。

### K6 高: publication文書の厳密な形式検証と対応一覧の追加が接続されていなかった

- **根拠:** [SeriesAnalysisArtifactSupport](../apps/api/src/main/scala/momo/api/adapters/postgres/SeriesAnalysisArtifactSupport.scala) は `contractVersion == 1` とフィールド集合の完全一致を要求する。旧計画P2はwriterとreader一覧の役割を分けるとしたが、生成文書の形式と全consumerの移行を確定していなかった。
- **壊れ方:** 形式1へ対応pair一覧を追加するとAPI起動時に拒否される。一方、consumerが各自pairを手書きすればSQL・validator・capability・smokeがずれ、片方だけ互換と判定する。
- **反映:** publication文書は形式2とし、writerの既存名フィールドと `readableContracts` を一つのRust契約表から生成する。実装仕様6節、P2/P3にexporter・API build/loader・release/control-plane/preemption smokeまで列挙した。manifest・queueのversionは変更しない。
- **証拠:** 形式/filenameのfreshness、writerがread一覧に含まれること、重複/未知/交差pair拒否、旧raw schemaの保持、実DB制約との一致。HTTPの生成識別子 `aggregateV2/V3` と保存resource kindも区別し、version名だけの一括置換をしない。

### K7 中: UIの派生stateと新旧分岐を散らせるままだった

- **根拠:** 現行 [query options](../apps/web/src/shared/api/seriesAnalysisQueryOptions.ts) は `keepPreviousData` を使い、[display bundle](../apps/web/src/features/seriesComparison/model/seriesAnalysisDisplayBundle.ts) がartifact/scope一致を確認する。Queryのplaceholderはkeyが変わっても旧dataを表示できるため、successだけでは要求中の成果物の証拠にならない。[TanStack Query公式資料](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)
- **壊れ方:** owner配列だけを別stateへcopyし、新しいstatusと古いowner値を結合する。URL ID、select候補、formatterのswitchが増え、片方だけ変わる。各cellで型castして旧データを新shapeと扱う。
- **反映:** P4/P5で既存bundleを正本にし、owner節の入口で生成unionを絞る。表示対応は一つの型付きcatalogに集約する。query keyはwire shapeと取得条件を区別し、表示指標を含めない。この区別はQueryの依存変数の原則と一致する。[Query keys公式資料](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- **証拠:** warm cache、旧bundleを保つ更新、異なるscopeの遅い応答、指標切替を通す。rendererが平均や品質を再計算しないこと、生成型をcastで迂回しないこともレビューする。

### K8 中: 共有tableの拡張境界が曖昧で、画面固有処理が入り得た

- **根拠:** [DataTable](../apps/web/src/shared/ui/data/DataTable.tsx) は既にtable semanticsと書式を所有する。旧P5はscroll機能を足すとだけ述べ、配置・測定・feature固有状態の境界を明示していなかった。
- **壊れ方:** owner専用props、各cellの測定、全画面scroll listener、指標ごとの別tableを足すと、既存利用箇所への影響とfocus喪失が増える。16cellに仮想化を加えて読み上げやstickyを複雑化する。
- **反映:** P5と責務表で、featureは配置と意味、sharedは内部scroll・sticky・focusを所有するとした。CSSを基本にし、必要なoverflow測定は領域単位に閉じる。新たなtable基盤・store・memoization層は増やさない。
- **証拠:** default consumerの代表例、行列headerの交点、長い内容、最小幅、keyboardの到達/離脱を確認する。広い画面の静止画だけでは完了にしない。

### 保守性の補助診断

software-design-philosophyの8問による**現時点の計画上の診断は7/8、8.75/10**。ISOの点数や実装品質の実測値ではない。修正前はinterfaceの深さ・契約説明・境界の見通しが不足していたため、それぞれ最小の入出力、public契約コメント、2節の所有者表を追加した。

| 問い | 計画上の判定と根拠 |
| --- | --- |
| 各moduleを一文で説明できるか | 可: 所有者表で計算・契約・read・navigation・指標・tableを定義 |
| interfaceが内部処理より単純か | 可: scope入力からpayload、既存chunk read、有限のintent引渡しへ限定 |
| 内部実装の変更をcallerへ漏らさないか | 可: accumulator、descriptor選択、表の測定を所有moduleへ閉じる |
| interfaceの約束を記すか | 可: 入出力・不変条件・empty/error・intent寿命をP2〜P5の実装条件に追加 |
| reviewで複雑さを評価するか | 可: 不要な派生state・重い再利用・別pipeline・汎用化を指摘 |
| 各moduleが判断を隠すか | 可: 意味計算、互換性、取得資源、表示対応、操作を分離 |
| 実装を読まず境界を追えるか | 可: 変更入口・所有者・失敗と証拠の対応を記載 |
| 実装時に設計改善へ必要な時間を使っているか | 未確認: 実装未着手。P2/P4の境界整理などが省略されていないかを実装reviewで確認する |

残る1問を文書だけで合格にして10/10としない。skillの10〜20%という配分目安を、このrepositoryの必須工数計測や新しいgateにはしない。上の「可」も計画への記載を評価したものであり、実装時にinterfaceと証拠を確認する必要がある。

### 改訂後の扱い

K1〜K8の修正先は実装計画の工程表に対応づけた。7指標・既存scope・一覧までという提供範囲は維持した。機能の追加、DB本番操作、library更新、新しい常設監視基盤は行っていない。今回の完了はレビューと文書改訂であり、数値の正しさ・互換移行・実画面・性能の実装証拠はP1〜P6で確認する。
