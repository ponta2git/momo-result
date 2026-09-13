# 操作時の反応を揃える実施計画

## 1. 位置付け

当初の提案をレビューした際の採用案は、次の3観点だった。

| 観点 | 採用内容 | 現在の扱い |
| --- | --- | --- |
| 1 | 輪郭は、操作の場所だけ少し明瞭にする | 入力境界・表の行フォーカスなど。今回の対象外 |
| 2 | 反応は、文字を鮮明に保ちながら面に返す | 本計画の対象 |
| 3 | 処理中も、読んでいる内容と操作位置を保つ | 待機表示・通知の統一と回帰修正を実装済み |

観点2の合意済みの方向は、主要ボタンのホバー時の全体半透明化を背景色の微差へ置き換え、副操作・開閉操作にも同じ反応を揃えること。表の行背景も滑らかにする。押下・フォーカス・エラーの認識は遅らせない。120msは既存値を流用した当初案であり、利用者の指摘を受け、色補間への一律適用を撤回する。時間とカーブは下記の根拠・比較手順で選ぶ。

本書は実装前の計画である。現行差分はコードで確認した。今回の色・時間の組合せの実画面評価は未実施で、色の確定値は先行適用時に決める。恒久的な契約は [UI規約](ui-rule.md)、実装方式は [architecture](architecture.md#client-lifecycle--suspense--motion)、検証は [test-rule](test-rule.md#4-web-evidence-catalog) へ反映する。

## 2. 反応の文法

| 状態・操作 | 採用する表示 |
| --- | --- |
| 通常 | 現在の色・文字・形・寸法・余白を保つ |
| 操作可能な部品・表の行へのホバー | 背景色と既存のホバー境界色を遅延なしで補間。100ms・標準ease-outを比較の基準案とし、下記の先行確認で確定 |
| ホバーを外す | 通常面へ滑らかに戻る。最初は進入と同じ時間で比較し、行を離れた後の色残りが問題になる場合だけ解除を短縮。再進入は現在の色から反転し、反応をキューに積まない |
| 押下 | 面をホバーより一段濃くして即時反映。移動・縮小・影は足さない |
| 押下の解除 | その時点の通常・ホバー・選択・処理中へ戻す。操作結果は補間を待たない |
| キーボードフォーカス | 既存のリングを即時表示。太さ・位置・読み順を保つ |
| 選択・現在地 | 選択面・印・意味を即時反映し、未選択用のホバーで覆わない |
| エラー・要確認・警告・確認済み | 意味のある面・境界を優先。通常面へのホバー置換を抑止し、問題の発生を即時表示 |
| 処理中・無効な操作、読取専用の入力欄 | 新しい押下・ホバー反応を出さない。既存の文言・無効表示・操作制限を使う |
| 動きを減らす設定 | 今回の補間を0msにし、同じ最終状態を即時表示 |
| ホバーできない端末 | タップ時の押下と結果を示し、タップ後に疑似ホバーを残さない |

文字・アイコンへホバー由来のopacityを掛けない。既存の文字色切替は必要な部品だけに保ち、補間対象には含めない。pending / disabledの減光は操作不能の識別として扱い、ホバー半透明化と一括で消さない。

表の行背景も補間する方針は確定した。行背景は「読む位置」、行内のbutton等は「操作対象」を示す。行全体にpointer cursorや押下表現を足してclickableに見せない。行への新しいfocus-within表示は観点1で扱う。

### 2.1 時間とカーブの根拠

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
3. まず進入・解除を同じ時間で比較する。色残りが問題になった場合だけ、同じカーブ・色で解除を一段短縮して再確認する（例: 進入100 / 解除80ms）。この非対称化は現時点では未採用。CSSでは途中反転が短縮されるため、常に指定時間いっぱい残ると仮定せず、実挙動を見る。[CSS Transitionsの反転仕様](https://www.w3.org/TR/css-transitions-1/#reversing)
4. 複数案が同等なら100msを採用し、部品別の値を増やさない。明確な違和感があれば、その問題を解消する候補を選び、対象・時間・カーブ・色・観測した差を記録する。候補すべてで問題が出る場合は色差も再評価し、長時間化やdelayで隠さない。

この比較を全画面への展開前の完了条件にする。静止画、計算上の補間率、参考資料だけで「滑らかさを確認済み」とは扱わない。実画面確認時には設定した時間と実際のframe更新を区別する。

## 3. 適用先と具体的な差分

| 実装入口 | コードで確認した現行 | 実施内容 |
| --- | --- | --- |
| [actionRecipes](../apps/web/src/shared/ui/actions/actionRecipes.tsx) | primary / dangerがhover:opacity-90、active:opacity-95。副操作は背景の即時切替 | Button・LinkButton・IconButton・IconLinkに背景色の状態と時間を共有。disabled属性・aria-disabledの両経路で反応を抑止 |
| [Control](../apps/web/src/shared/ui/forms/Control.tsx) | 共通hoverがtone別の背景にも適用され得る | 通常の編集可能なinput・select・textareaだけ既存hover面を補間。invalid・tone・disabled・readOnly・編集中の表示を優先。通常時の輪郭は観点1まで保つ |
| [Tabs](../apps/web/src/shared/ui/forms/Tabs.tsx)・[SegmentedControl](../apps/web/src/shared/ui/forms/SegmentedControl.tsx) | 未選択の背景・境界が即時切替。一部はdisabledにもhover classが残る | 操作可能な未選択部分に適用。選択・focus・activationを即時に保つ。underline tabへ新しい広い塗りを足さない |
| [ChoiceList](../apps/web/src/shared/ui/forms/ChoiceList.tsx)・[CheckboxField](../apps/web/src/shared/ui/forms/CheckboxField.tsx) | labelのhoverと親の選択・disabled表示が別々 | 選択面をhoverで覆わず、無効なlabelに反応を出さない。候補の付随操作は別のbuttonとして保つ |
| [Disclosure](../apps/web/src/shared/ui/data/Collapsible.tsx) | triggerの背景は即時、矢印は既存120ms | triggerの背景へ適用。開閉・矢印・focusの契約を維持 |
| [GlobalNav](../apps/web/src/shared/ui/layout/GlobalNav.tsx) | 未選択の面・境界が即時切替 | 未選択の行先へ適用。現在地・横スクロールの挙動を維持 |
| [DataTable](../apps/web/src/shared/ui/data/DataTable.tsx) | 行背景と並べ替えbuttonにhoverがある | 行背景と並べ替え等の実操作へ補間を適用。行を続けて横切る場合を時間選定の主要な確認対象とする |
| feature内の独自linkなど | 一部に下線や文字色のhoverがある | 既存のリンク識別を維持。面のない本文linkへ塗り・padding・ラッパーを足さない |

共通部品から試合・開催・比較・OCR・出力・設定・アカウント・認証へ適用する。個別画面のhandler、query、cache、フォーム、Suspense、Toastの判断は変更しない。観点3で修正したbuttonの空きicon欄やOCRの空行を再導入しない。

## 4. 色と実装方式

[styles.css](../apps/web/src/styles.css) の参照色→意味トークン→部品の関係を保つ。主な追加はaction-hover / pressed、danger-hover / pressed、surface-pressedとする。quietな危険操作は既存の淡いhover面を基準に押下との差を作る。

主要・危険操作は現在の色相・彩度を保ち、ホバーの明度を約1.5ポイント上げ、押下を約2ポイント下げた参照色を試作の出発点にする。無彩色は既存のsurface-hoverを活かし、pressedをneutralの96%付近から確認する。これらは確定値ではなく、文字のcontrast基準を満たし、状態を識別できる最小の差で決める。通常色やページ背景、順位・メンバーの意味色は変更しない。

現在のarchitectureは「それ以外の新しい有限 motion は Motion に統一」と定め、CSSをloadingのloopに限定している。今回の色補間はCSSの状態指定で扱う方が単純なため、実装前に次の限定例外を正本へ追加する案とする。

- 共通操作部品のnativeなhover / active、および既存の表の行ホバーによるbackground-color / border-color補間だけ、shared UIが所有するCSSに置く。
- 時間・easing・reduced motionの共通定義を持ち、selected / invalid / tone / disabled等の優先は各部品で対応付ける。featureから個別の時間・色を受け取らない。
- open / close、presence、既存の矢印・選択indicatorはMotionが担当する。同じ要素の同じpropertyを両方式で動かさない。
- hover用のReact state、pointer handler、timer、追加ラッパー、gesture bundleは導入しない。色の補間完了を操作の条件にしない。

先行確認で採用したCSSの時間とeasingは色反応の共通定義に置く。用途が異なる[既存Motionの共通値](../apps/web/src/shared/ui/motion/transitions.ts)と同じ数値であることを目的にせず、部品内で数値を個別指定しない。新しいtheme生成工程やMotion全体の移行は行わない。

汎用のtransition-all / transition-colorsは使わない。transition-colorsにはoutline-color等も含まれるため、補間propertyを背景・境界へ限定し、CSS側でもreduced motionを明示する。[Tailwind公式のtransition定義](https://tailwindcss.com/docs/transition-property)、[状態variant](https://tailwindcss.com/docs/hover-focus-and-other-states)を実装時に参照する。

## 5. 実施順序とコミット単位

| 順序 | 作業 | 完了条件・記録 |
| --- | --- | --- |
| 1 | 対応表・規約の確定 | 行背景も滑らかにする確定方針を反映。UI規約に対象・時間の選び方・状態の優先、architectureにCSSの限定例外、必要な検証条件を既存の正本へ反映。docsのコミット |
| 2 | 共通定義・button群・表の行への先行適用 | 主・副・quiet・danger・icon・linkの色を絞り、行とbuttonで2.1の時間・カーブ比較を実施して値を確定。文字の鮮明さ、押下の識別、無効状態、処理中の寸法保持を確認してコミット |
| 3 | 入力・選択・開閉・ナビへの展開 | 上の適用表を完了。OCRの要確認・警告、入力エラー、選択中・無効・読取専用をhoverが上書きしない。部品群ごとにコミット |
| 4 | 連続操作での検証・調整 | 通常・狭幅・keyboard・touch・reduced motion、素早い往復、押下中の逸脱、処理中への切替を確認。必要な修正をコミット |
| 5 | 完了報告・作業文書の整理 | gate・確認経路・未検証事項を報告。恒久ルールを正本へ残し、本書の実装済み差分を整理 |

実装は依頼後に行う。本計画の作成だけでは規約変更・UIへの適用を完了扱いにしない。

## 6. 受入条件と検証

- 通常時の配置・寸法を保ち、hover / pressedの切替で文字・icon・隣接操作が動かない。primary / dangerの文字が薄くならず、通常・hover・pressedで既存のcontrast基準を満たす。
- hoverは2.1の先行確認で選んだ共通時間・カーブと遅延0を使う。反転時は現在の色から応答し、最終のpointer位置・semantic stateと表示が一致する。focus、選択、error、pending / disabledの認識・操作制限は補間完了を待たない。
- 選択済みtab・候補、OCRの状態色、invalid入力を通常hoverが覆わない。ポインターを乗せたまま状態が変わる場合も確認する。disabled / aria-disabled / readOnlyを操作可能に見せない。
- 動きを減らす設定では今回の補間を省略し、同じ状態・操作結果になる。touchでhover残りを生じさせない。
- 試合・開催一覧で主副操作と並べ替え、OCRで状態別の入力と開閉、出力で長い文言と処理中・再試行、比較・設定でtabとkeyboard activation、管理・認証・dialogで危険操作と無効linkを確認する。
- Playwright MCPで画面幅320 / 390 / 1440pxを用途に応じて使い、pointer・keyboard・touch相当・reduced motionを確認する。視認性・残像感・関係的余白は実画面で評価する。現在はPlaywright MCPの接続が切れており、本計画段階の新しい実画面評価は未実施。
- 自動検証は既存の操作契約と追加色対のcontrastを中心に選ぶ。class一致やjsdom寸法で見た目を代用せず、production CSSにtokenと状態styleが残り代表画面で有効なことも確認する。hover classを写すだけのtestや全画面の重複snapshotは追加しない。

Web gateはformat、lint、typecheck、影響するunit / component test、build、主要flowのPlaywright。docsはgit diff --checkとpublic:safety:checkを実行する。検証後は新しい変更・失敗・具体的な懸念に応じた範囲だけ再実行する。
