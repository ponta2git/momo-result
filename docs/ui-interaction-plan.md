# 操作時の反応を揃える実施計画

## 1. 位置付け

当初の採用案は、次の3観点だった。

| 観点 | 採用内容 | 現在の扱い |
| --- | --- | --- |
| 1 | 輪郭は、操作の場所だけ少し明瞭にする | 入力境界・表の行フォーカスなど。今回の対象外 |
| 2 | 反応は、文字を鮮明に保ちながら面に返す | 本計画の対象 |
| 3 | 処理中も、読んでいる内容と操作位置を保つ | 待機表示・通知の統一と回帰修正を実装済み |

観点2では、主要ボタンのホバー時の全体半透明化を面の微差に置き換え、副操作・開閉操作も揃える。表の行背景も滑らかにする方針は合意済み。押下・フォーカス・エラーの認識は遅らせない。120msは既存値を流用した当初案であり、色補間への一律適用を撤回した。

本書は実装前の計画である。2026-09-14の敵対的レビューで、時間だけの統一、状態の単純な優先順位、CSS例外を先に規約化する手順を見直した。現行コードと依存packageを確認し、CSSの状態競合をPlaywright MCPの独立した再現例で確認した。製品上の新しい反応の実装・実画面評価は未実施。恒久的な契約は [UI規約](ui-rule.md)、実装方式は [architecture](architecture.md#client-lifecycle--suspense--motion)、検証は [test-rule](test-rule.md#4-web-evidence-catalog) へ反映する。

## 2. 敵対的レビューの結論

| 旧案への反例 | 判定・修正 |
| --- | --- |
| 同じ100msでも、大きい行と小さいbuttonが同じ強さで光ると騒がしい | 時間に加え、反応する面積・色差・意味を揃える。行の反応は操作部品より弱くする。これは本アプリの設計仮説であり実画面で比較する |
| selectedを最優先にして全反応を消すと、チェックを解除できることまで伝わりにくい | 意味の印と操作への反応を別にする。変更可能な選択済みcontrolにも、その選択面の範囲で反応を返す |
| invalid時だけtransitionを無効にしても、解除時に通常hoverへ補間される | 状態の発生・解除の両方向を扱う。意味の色と一時的なhover量を分離する。第5章の再現例で旧方式の失敗を確認 |
| readOnlyとdisabledをまとめると、focus・選択・copyもできないように見える | 編集不可と操作不可を分ける。readOnlyは編集を誘う反応を足さず、読む・選択する操作とfocusを保つ |
| 行と子buttonが同じ押下反応を返すと、行全体がclickableに見える | 行は読む位置の補助だけ。押下・focus・実行は子の操作部品が所有する |
| Motionなら自動的に秩序ができる、CSSなら必ず無秩序になる | どちらも誤り。公開API、色と状態の所有者、補間対象、検証範囲を閉じることが必要。方式は第5章の比較で決める |
| 共通recipeを直せば全画面が揃う | 独自link、Base UIのrender差替え、labelと親の選択面、disabled linkは別経路。第6章で入口と適用結果を追跡する |

## 3. 改訂する反応の文法

### 3.1 見た目の意味とイメージ

目指す像は、文字・位置・輪郭が安定したまま、触れた面の濃さだけが小さく応える状態である。通常時の色・形・寸法・余白は保つ。「浮く」「跳ねる」「発光する」「波が広がる」表現は足さない。

| 利用者が受け取る意味 | イメージの定義 | 部品への対応と強さ |
| --- | --- | --- |
| ここを操作できる | 面の濃さがわずかに増し、文字はそのまま鮮明 | 主・副・quiet・danger・icon・link button。現在の意味色を保ち、hoverよりpressedを一段明瞭にする |
| ここを押している | 面の濃さが直ちに定まる | 実行・切替・開閉できる対象だけ。大きさ・位置・影は変えない。選択済みを意味する固定背景には転用しない |
| ここを編集できる | 入力面だけが静かに応える | 編集可能なcontrol。inputにbuttonの押し込み表現を移植しない。入力中のfocusとエラー境界を保つ |
| ここが現在の選択・行先 | 印が残り、その面の中で反応する | check、選択ラベル、tabのindicator、現在地を保持。hoverで未選択と同じ面に戻さない |
| 今この行を読んでいる | 薄い帯で横方向を追える | 表の行。操作部品より弱い変化とし、行内buttonの反応と重なっても強い帯にならない |
| キーボードの操作先はここ | 輪郭が直ちに現れる | 既存focus ringを独立して表示。hoverやpressedの間も消さない |
| 状態が変わった | 印・文言・意味の色が直ちに変わる | selected / invalid / review / warning / success / pending。補間途中でも状態を読み違えない |

「同じ快適感」は全要素を同じ明度差にすることではなく、同じ意味に同じ反応を返すことで定義する。有色buttonと淡色controlは色対を別に持つ。広い行・labelの色差を小さいbuttonから機械的に複製しない。面のない本文linkは既存の下線などを維持し、新しい塗りやpaddingを足さない。

先行適用では実部品を横に並べ、通常→hover→pressedと、selected / invalid＋hoverの見本を同じ背景上で比較する。この状態見本と連続操作をイメージの確認手段にする。静止見本だけで時間の快適さを確認済みとしない。

### 3.2 状態の合成と遷移

一つの優先順位リストへ全状態を押し込まず、次の四つを分ける。業務状態のコピーや新しいglobal stateは作らない。

1. **操作可能性**: owning primitiveのdisabled / aria-disabled / fieldset / inertと、featureが決めた操作制限に従う。aria-busyだけから一律に操作不能を推測しない。readOnlyは別に扱う。
2. **意味の基底**: variant、selected、tone、invalidが、面・境界・印・文言を決める。invalidとtoneの関係など既存の意味契約を保つ。
3. **一時的な反応**: 操作可能な対象へのhover・pressed。選択面・状態面に対応した色対の中で変化し、意味の基底を上書きしない。行は読取り専用の反応に限定する。
4. **focus**: 別の輪郭として重ねる。前の三つから表示を消さない。実際のfocus移動はnative / Base UIが所有する。

| 変化の原因 | 表示と時間の契約 |
| --- | --- |
| hoverの進入・解除だけ | 開始遅延0で短く補間。第4章の共通時間・カーブを使い、現在値から応答する。反応をキューに積まない |
| pressedの開始・解除 | native / Base UIの操作状態を即時に返す。解除後は現在のhoverと意味の基底へ戻す。押下を長く見せるtimerや最低表示時間を作らない |
| selected・tone・invalidの発生と解除 | 印・文言・面・境界を新しい意味へ即時更新。hover中でも古い意味色を残さない。hoverの進行量だけが残ることはよい |
| disabled / pendingの操作制限が変化 | 制限とその表示を即時反映。hover・pressedによる強調を外す。解除時も現在の状態へ復帰し、過去の押下を再生しない |
| focusの取得・喪失 | 既存ringを即時切替。色補間の対象に含めない |
| 動きを減らす設定 | hover補間を0msにし、同じ最終の面・印を示す。実行中に設定が変わる場合も止める |
| touch | hoverを作らず、nativeの押下と実行結果を返す。スクロール・cancelで押下を残さない |

選択済みcheckboxや切替可能な項目は反応を残す。選択済みradio / tab / 現在地は、その部品で可能な操作に合わせ、再選択で意味が変わるような印は追加しない。候補に付随するbuttonは親のradio labelとは別の操作である。編集可能なinvalid入力もfocus・編集を妨げず、意味色の中で面の変化を返す。

今回の即時表示の契約は、hover補間によって意味の認識を遅らせないためのもの。既存の矢印・tab indicatorの移動は今回変更せず、選択文字色・accessible state等の即時更新と併存させる。これら既存Motionを全て0msへ変更する計画ではない。

文字・iconへhover由来のopacityを掛けない。既存の文字色切替は必要な部品だけに保ち、補間しない。pending / disabledの減光は操作不能の識別として残す。新しい行focus-withinは観点1で扱い、行へpointer cursor、tabIndex、押下表現を追加しない。

## 4. 時間・色の根拠と確定手順

**外部資料が支持するのは短い反応の範囲であり、120msという最適値ではない。** [NN/gのanimation設計指針](https://www.nngroup.com/articles/animation-duration/)は、checkbox等の単純なfeedbackを約100msとしている。[IBM Carbonのmotion指針](https://carbondesignsystem.com/elements/motion/overview/#duration)ではbutton / toggleに70ms、fadeに110msのtokenを割り当てる。これらは設計上の目安・他製品の定義であり、このアプリの行背景に対する比較実験ではない。一般的な「応答時間0.1秒」の知見も、色補間を完了する時間と同一視しない。

**既存の時間だけでなく、変化の配分も見直す。** [現在の共通Motion](../apps/web/src/shared/ui/motion/transitions.ts)は120ms、cubic-bezier(0.16, 1, 0.3, 1)である。[CSS Easingの定義](https://www.w3.org/TR/css-easing-1/#cubic-bezier-easing-functions)に従って曲線を計算すると、出だしに変化が強く集中する。

| 時間・カーブ | 補間が50%まで進む時間 | 補間が90%まで進む時間 |
| --- | --- | --- |
| 既存120ms・cubic-bezier(0.16, 1, 0.3, 1) | 約12ms | 約40ms |
| 比較の基準100ms・ease-out（0, 0, 0.58, 1） | 約34ms | 約74ms |

計算はBezier曲線のyが0.5 / 0.9になる点のxを全体時間に掛けたもの。これは補間進捗の計算であり、見た目の変化量・人間の知覚率・browserでの実測ではない。既存カーブを色へ流用すると、短い通過でも早期に強く色が変わる可能性があるため、全体時間だけを延ばして滑らかさを作らない。既存の矢印・選択indicatorのカーブは変更せず、色の反応を別用途として評価する。

**現段階の基準案は100ms・標準ease-out・開始遅延0とする。** 約100msという外部指針、素早い反応と初動の急変を両立させる目的から選んだ試作値であり、最適性が実証された確定値ではない。ボタンと行で初めから別々の時間を作らず、次の順で決定する。

1. 試合一覧・開催履歴の実際の行と主副buttonで、色の始点・終点を固定し、80 / 100 / 120msを同じease-outで比較する。80は短い側、120は当初案との比較用。0msは現行表示との対照にだけ使う。遅延時間は全条件で0。
2. pointerを留める、素早く数行を横切る、斜めに行内buttonへ移る、境界を往復する操作を通す。短い通過で行が次々に強く光らないこと、停止した行が追えること、離れた行の色が残って追跡を妨げないことを評価する。
3. まず進入・解除を同じ時間で比較する。色残りが問題になった場合だけ、同じカーブ・色で解除を一段短縮して再確認する（例: 進入100 / 解除80ms）。この非対称化は現時点では未採用。CSSの反転短縮とMotionの中断を同一視せず、採用する実装の途中反転を確認する。[CSS Transitionsの反転仕様](https://www.w3.org/TR/css-transitions-1/#reversing)
4. 複数案が同等なら100msを採用し、部品別の値を増やさない。明確な違和感があれば、その問題を解消する候補を選び、対象・時間・カーブ・色・観測した差を記録する。候補すべてで問題が出る場合は色差も再評価し、長時間化やdelayで隠さない。

この比較を全画面への展開前の完了条件にする。静止画、計算上の補間率、参考資料だけで「滑らかさを確認済み」とは扱わない。実画面確認時には設定した時間と実際のframe更新を区別する。

[styles.css](../apps/web/src/styles.css) の参照色→意味トークン→部品の関係を保つ。action / danger / neutralのhover・pressed、および既存のselected / toneに対する必要な色対を定義する。主操作のhoverだけ明度を上げる旧試作案は見直し、通常→hover→pressedで面の濃さが増す方向から比較する。全色へ同じ明度差を掛けるformulaや、各部品に自由なalpha値を渡すAPIは作らない。

色差は現行surface-hoverを基準に、状態を見分けられる最小の範囲で決める。通常・hover・pressedと補間途中の文字contrast、selected / invalidの印の判別を確認する。行では色差を控え、子buttonとの重なりを実画面で判断する。通常色、ページ背景、順位・メンバーの意味色は変更しない。確定後は用途ごとの色対を正本にし、試作用の任意値をconsumerへ残さない。

## 5. 実装方式と自由度の管理

### 5.1 CSS例外案の判定

**「色補間ならCSSを許す」という旧案は採用前提から外す。** CSSの少ない記述量は利点だが、背景・境界へ一律transitionを指定し、優先関係を各部品へ委ねるだけでは第3章を満たせない。

Playwright MCPで、hover中の要素にinvalid色＋`transition: none`を付け、解除する独立した再現例を実行した。invalidへの変更時はanimationなしだったが、解除時は古いinvalid色を始点とする100msの`background-color` transitionが生成された。これは旧方式の反例であり、現行製品に新しいCSS transitionを実装して観測した不具合ではない。[CSS Transitions仕様](https://www.w3.org/TR/css-transitions-1/#reversing)も、反転短縮が二状態を超える遷移を完全には扱わないとしている。

| 比較案 | 得られるもの | 増える責務・リスク | 今回の判断 |
| --- | --- | --- | --- |
| 部品ごとの限定CSS transition | native状態を短く書ける。gesture bundleを増やさない | 意味変更との競合、CSSとMotionの時間・reduced motion・中断の二系統管理、selectorの例外増加 | 旧案は不採用 |
| hover量だけを補間する中央CSS実装 | native状態を保ち、意味色との競合を分離できる可能性 | custom propertyの補間方式・browser対応、有限CSSの別ownerと境界検査が必要 | 比較上の代替案。部品側CSSの自由化とは区別するが、第一候補にはしない |
| 現行domMin＋自前のhover / press管理 | providerを変えずMotionへ集約できる | touch判別、押下中の逸脱、keyboard、cancel等の再実装が増える | bundle削減だけを理由に採用しない |
| Motionのhover機能＋中央の状態投影 | 有限補間をMotionへ集約し、featureへ時間・状態調停を漏らさない | 現行domMinからの機能範囲拡張、bundle増分、browser描画負荷を確認する必要 | **先行検証する第一候補**。成立を確認してからarchitecture decisionと実装を確定 |

Motion採用そのものは秩序の保証ではない。自由な`whileHover` / `transition`を各画面へ配れば同じ問題になる。逆に、中央に閉じたCSSなら管理可能な余地はある。今回は既存の有限Motion方針を活かし、方式の並立より一つの投影契約へ集約する利点を優先する。未測定のbundle差や性能を根拠に優劣を断定しない。

### 5.2 第一候補の構造と限定範囲

- **CSSは静的な意味と描画**を所有し、**Motionはhover量0〜1の補間**を所有する。意味に対応した通常色・hover色をその量で混ぜることで、selected / invalidが変わっても旧色を補間元として保持しない。試作は`color-mix(in oklab, …)`で色空間も共通にする。対象は背景と既存のhover境界色に限り、それ自体への汎用transitionは置かない。押下・focus・操作制限は補間から独立して即時表示する。
- 共通の内部recipeが色対と投影を所有し、共通のMotion接続が開始・解除・reduced motion・初回表示を所有する。各primitiveは自身がすでに持つ意味と操作可能性を対応付ける。hover量をReactの業務stateへ複製せず、親Pageを再renderするためのイベントにしない。
- 現行の`m`、`LazyMotion strict`を維持し、候補は`domAnimation`のうちhover利用までに限定する。`whileTap` / `onTap`で実行を代替せず、click、Space / Enter、focus、open、選択はnative / Base UIへ残す。tap / focus gesture、layout、drag、pan、springをこの変更で解禁しない。
- ボタン・link・label・tr自身に接続し、装飾用wrapperやoverlay DOMを増やさない。内部custom propertyは各対象で初期化し、親行のhover量が子buttonへ継承される事故を防ぐ。CSSとMotionが同じpropertyへ別々の補間を掛けない。
- [Base UIのrender / mergeProps](https://base-ui.com/react/utils/merge-props)を使う接続では、ref、イベント、accessible属性、nativeButtonの契約を保つ。featureにrender差替えがある場合も同じ入口を通るか確認する。
- `MotionConfig reducedMotion="user"`だけでは色等の補間は消えないため、接続側で今回のhover量の補間を0msにする。[MotionConfig公式仕様](https://motion.dev/docs/react-motion-config)

[Motion公式](https://motion.dev/docs/react-animation)はCSS変数の補間とOKLCHを含む色を扱えるとしている。採用中の13.2.0のsourceでも、`domMin`はanimationとrenderer、`domAnimation`はそれにgesture群を加える構成だった。hover実装はtouchを除外する一方、押下中のleaveをreleaseまで遅らせる経路もある。単にfeature名だけで適合とせず、行の走査、子buttonへの移動、押下後の逸脱を試す。[hover仕様](https://motion.dev/docs/react-hover-animation)、[bundleの公式説明](https://motion.dev/docs/react-reduce-bundle-size)

意味色とhover量を分ける描画案は、固定の量0.5でinvalidの発生・解除を切り替え、色が同期して変わることを独立したbrowser例で確認した。ただしMotionとの接続・Base UI・実画面は未検証である。CSS変数更新は描画コストがなくなる仕組みではなく、色変更がcompositorだけで済むとも仮定しない。

先行検証の終了条件は、(a) 意味変更の両方向と操作制限の即時表示、(b) native操作・DOM identityの維持、(c) 行の中断・touch・reduced motion、(d) production bundle増分と連続走査時のframe更新を記録すること。既存表示と同条件で比較する。自前gesture補修や部品別例外が増える場合は、その方式のまま横展開せず、中央CSS案を含め再比較する。規約は候補の実証後に更新し、現在禁止されるimportを先に製品へ広げない。

### 5.3 公開APIと保守の境界

| 層 | 所有する判断 | 下流へ渡す契約 |
| --- | --- | --- |
| デザインの定義 | 意味・イメージ、第3章の遷移、第4章の時間と色対 | 操作・編集・読取りの三用途。部品名ごとの時間は作らない |
| semantic tokenとshared内部の反応定義 | 色対、hover量の投影、共通時間・カーブ・reduced motion | 意味に対応する閉じた組合せ。任意色・任意alpha・任意durationは受け取らない |
| shared primitive | variant、selected、tone、invalid、disabled等から反応を選ぶ。native / Base UI接続 | 現行の用途・状態props。consumerへエンジンやhover状態を渡さない |
| feature / app | 業務状態、操作可否、副作用、画面のcomposition | 共通部品を利用する。画面別の微調整値を持たない |

新しい`AnimatedButton`や`FadeSurface`のような並行部品は作らず、既存Button等を接続する。共通化は状態投影・reduced motion・中断を隠せる最小の内部単位にする。variant×状態の全組合せを任意設定できる汎用animation frameworkにはしない。

既存の[型契約](../apps/web/src/shared/ui/uiOwnership.typecheck.ts)はleafのclassName / style等の外部上書きを防いでいるが、時間・gestureやBase UIのrender差替えまで包括的に保証してはいない。実装時に新しいduration / easing / animation propsを公開しない型契約を補い、[標準lint](../apps/web/oxlint.config.ts)のimport制限は採用した中央moduleに必要な範囲だけ更新する。CSS selectorの意味や全render経路を正規表現で保証するcheckerは追加せず、対応表のreviewと実際の操作で確認する。

## 6. 部品への接続と横展開

時間tokenを配るだけでなく、各部品に用途と接続箇所を割り当てる。以下は全て未実装。各段階で「適用済み／既存の意味表現を維持して対象外／未解決」と確認したconsumerをこの表へ追記し、取りこぼしを残さない。

| 実装入口 | 用途・接続する箇所 | 現行からの差分と守る条件 |
| --- | --- | --- |
| [actionRecipes](../apps/web/src/shared/ui/actions/actionRecipes.tsx) | 操作。Button・LinkButton・IconButton・IconLink本体 | primary / dangerのhover:opacity-90、active:opacity-95を面の色対へ変更。色のrecipeとMotion接続を全4経路で共有し、disabled button・aria-disabled link・form pendingを確認 |
| [DataTable](../apps/web/src/shared/ui/data/DataTable.tsx) | 読取りはtr、操作は並べ替えbutton等 | 行と子操作の強さを分ける。hover量の継承を防ぎ、行の連続走査を時間選定に使う。trの意味・DOMを保つ |
| [Control](../apps/web/src/shared/ui/forms/Control.tsx) | 編集。input・select・textarea | 共通hoverがtone面を覆い得る経路を解消。invalid / review / warning / successの色対を対応付け、発生・解除とreadOnlyを確認。通常の輪郭は維持 |
| [Tabs](../apps/web/src/shared/ui/forms/Tabs.tsx)・[SegmentedControl](../apps/web/src/shared/ui/forms/SegmentedControl.tsx) | 操作。tab / button | active・disabledをBase UI等の正本から対応付け、選択面と反応を分ける。underline tabに広い面を新設せず、既存indicatorとfocus・activationを維持 |
| [ChoiceList](../apps/web/src/shared/ui/forms/ChoiceList.tsx)・[CheckboxField](../apps/web/src/shared/ui/forms/CheckboxField.tsx) | 操作。native inputに結び付くlabel | ChoiceListの選択面は親、hover面はlabelにある。意味と反応が同じ結果になるよう色対を接続する。fieldset disabled、選択解除、付随buttonの独立性を確認 |
| [Disclosure](../apps/web/src/shared/ui/data/Collapsible.tsx) | 操作。trigger | trigger背景へ接続。展開中を選択面として扱わず、panelに背景を足さない。矢印の既存Motion、open・focusを維持 |
| [GlobalNav](../apps/web/src/shared/ui/layout/GlobalNav.tsx) | 操作。各link | 現在地の印・面を保った反応へ接続。横スクロールとURLを維持 |
| feature内の独自link・render差替え | 既存の意味に応じて分類 | 本文linkは既存下線等を維持して面補間の対象外と記録。button相当の重複実装は既存shared部品へ寄せる。差替えで共通接続を外していないか確認 |

展開前に上記入口のconsumerと、独自のhover / active / transition / opacity指定を検索し、対象となるものを対応付ける。検索一致だけで適合判定せず、利用者が触る実要素を確認する。共通部品を採用済みの画面には新しい反応propsを配らず、部品内部の接続によって同じ定義を届ける。例外が必要なら画面内へ値を追加せず、既存用途で表せない利用者上の理由と他consumerへの影響から判断する。

試合・開催・比較・OCR・出力・設定・管理・アカウント・認証へ適用する。handler、query、cache、フォーム、Suspense、Toastの判断は変更しない。観点3で修正したbuttonの空きicon欄やOCRの空行、比較の切替待機、再訪時cacheの回帰を起こさない。

## 7. 実施順序とコミット単位

| 順序 | 作業 | 完了条件・記録 |
| --- | --- | --- |
| 1 | 接続方式の先行検証とconsumer棚卸し | button＋子操作を持つ行＋invalid入力＋選択labelで第5章の候補を試す。操作契約、意味変更の両方向、描画、bundle差分から方式を確定。規約を先に緩めない |
| 2 | 正本・共通定義・代表部品の確定 | 実証した範囲をUI規約・architecture・必要な検証契約へ反映。UI規約の「最短token」「主にopacity / transform」と今回の色反応を整合させる。button群と行で第4章の比較・状態見本を作り、時間と色対を確定。docsと実装をreview可能な単位でコミット |
| 3 | 入力・選択・開閉・ナビへの展開 | 第6章の用途と色対で接続。部品群ごとに関連consumerの代表操作を確認してコミット。未対応箇所と対象外理由を表へ残す |
| 4 | アプリ全体の接続確認と回帰修正 | 対応表の未解決を解消。独自実装・render差替えを再確認し、主要flowで第8章の受入条件を検証。必要な修正をコミット |
| 5 | 完了報告・作業文書の整理 | 採用方式、色・時間、比較条件、gate、未検証事項を報告。恒久ルールは正本へ残し、本書の実装済み差分を整理 |

実装は依頼後に行う。本計画の更新だけでは規約変更・UIへの適用を完了扱いにしない。

## 8. 受入条件と検証

- 通常時の配置・寸法を保ち、hover / pressedで文字・icon・隣接操作が動かない。primary / dangerの文字が薄くならず、通常・hover・pressedと補間途中で既存のcontrast基準を満たす。
- hoverは第4章で選んだ共通時間・カーブと遅延0を使う。途中反転で通常色へ飛び戻らず、最終のpointer位置・semantic stateと表示が一致する。focus、選択、error、pending / disabledの認識・操作制限は補間完了を待たない。
- ポインターを乗せたままselected・invalid・toneを変更・解除する両方向を確認する。選択や状態の印を保持し、変更可能な選択済みcontrolには反応がある。disabled / aria-disabledの抑止とreadOnlyのfocus・選択・copyを区別する。
- native button、link、Base UI trigger、radio / checkboxのSpace / Enterをそれぞれ既存の契約で実行し、二重実行しない。押下中の逸脱、cancel、途中の無効化、再有効化で反応を残さない。hoverのためにfocus順・URL・フォーム送信を変更しない。
- 動きを減らす設定では今回の補間を省略し、同じ状態・操作結果になる。設定変更で実行中の補間も止まる。touchでhover残りを生じさせない。
- 試合・開催一覧で主副操作と並べ替え、OCRで状態別の入力と開閉、出力で長い文言と処理中・再試行、比較・設定でtabとkeyboard activation、管理・認証・dialogで危険操作と無効linkを確認する。
- Playwright MCPで画面幅320 / 390 / 1440pxを用途に応じて使う。視認性・残像感・関係的余白は実画面で評価する。接続は利用可能。本計画段階では第5章の独立した再現例のみ実行済みで、製品の新しい反応の実画面評価は未実施。
- 自動検証は既存の操作契約と追加色対のcontrastを中心に選ぶ。class一致やjsdom寸法で見た目を代用せず、production CSSにtokenと状態styleが残り代表画面で有効なことも確認する。hover classを写すだけのtestや全画面の重複snapshotは追加しない。

失敗条件に応じた代表ケースを選ぶ。状態投影の競合は中央の接続、Base UIとnativeの差は各接続方式、余白と行走査は組み上がった画面で確認し、全状態×全部品×全画面の総当たりにはしない。第6章の全入口が接続済みか対象外として説明され、未解決がなくなったことを横展開の完了条件にする。

Web gateはformat、lint、typecheck、影響するunit / component test、build、主要flowのPlaywright。docsはgit diff --checkとpublic:safety:checkを実行する。検証後は新しい変更・失敗・具体的な懸念に応じた範囲だけ再実行する。
