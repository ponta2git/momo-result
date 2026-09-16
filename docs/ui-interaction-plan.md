# 操作面の反応を揃える実施記録

## 1. 実装した範囲

採用案の観点2「文字を鮮明に保ちながら面に反応を返す」を実装した。通常の形・寸法・余白を保ち、ボタンの全体半透明化を小さな背景色の変化へ置き換え、入力・選択・開閉・一覧・ナビへ展開した。観点1の輪郭強化は対象外。観点3で整えた待機表示・通知の判断は維持する。

表示契約の正本は [UI規約](ui-rule.md#操作面の反応)、実装境界は [architecture](architecture.md#client-lifecycle--suspense--motion)、検証契約は [test-rule](test-rule.md#loading--optimistic-update--motion)。本書は選定理由と今回の確認範囲を残す実施記録であり、進行中の計画ではない。

## 2. 確定した反応の文法

目指す像は「文字・位置・輪郭が安定したまま、触れた面の濃さだけが小さく応える」。同じ意味に同じ反応を返し、反応面積が大きい行は操作部品より弱くする。

| 意味 | 表示 |
| --- | --- |
| 操作できる | その意味色の中で面の濃さが少し増す。文字・iconのopacityは変えない |
| 押している | 操作部品の面が直ちに一段濃くなる。大きさ・位置・影は変えない |
| 編集できる | 入力面だけが静かに応える。押し込み表現は付けない |
| 選択済み・現在地 | 印と意味色を保ったまま、その面の中で反応する |
| この行を読んでいる | 薄い帯で横方向を追える。行全体をclickableに見せない |
| キーボードの操作先 | 既存focus ringを即時に示す。面の反応と独立させる |
| 状態が変わった | selected・invalid・tone・操作制限を即時反映し、旧状態の色を残さない |

操作可能性、意味の基底、一時的な反応、focusの四つを分離した。readOnlyは編集を誘う反応を消し、focus・文字選択・copyを維持する。disabledの抑止はnative / Base UIを正本にする。面のない本文linkには塗りやpaddingを追加しない。

## 3. 時間と方式の選定

**hoverは100ms・cubic-bezier(0, 0, 0.58, 1)・開始遅延0に統一した。** 進入・解除とも現在値から補間し、部品別の時間や非対称な解除時間は設けない。pressed・focus・意味変更は即時、動きを減らす設定ではhoverも即時とする。既存の矢印・indicatorの120msとは用途を分ける。

[NN/g](https://www.nngroup.com/articles/animation-duration/)の単純なfeedback約100ms、[Carbon](https://carbondesignsystem.com/elements/motion/overview/#duration)のbutton / toggle 70ms・fade 110msは短い反応の目安として使った。これらは本アプリの最適値を証明する資料ではない。旧カーブ（0.16, 1, 0.3, 1）は120ms中約12msで補間進捗50%へ達するため、色の初動が急になりすぎない標準ease-outへ分けた。進捗率は知覚率ではない。

試合一覧の行で色対とカーブを固定し、80 / 100 / 120msの更新と途中反転をPlaywright MCPで比較した。全候補で最終のpointer位置へ収束し、取得できた中間frameは順に4 / 5 / 7だった。入力遅延や残像の定量評価ではなく、100msの最適性も主張しない。候補間に機能上の優位がない場合は100msとする判断規則を適用した。buttonは採用値で面・文字・寸法を確認したが、開催一覧とbuttonを含めた全候補の知覚比較は未実施である。

| 比較した方式 | 結論 |
| --- | --- |
| 背景・境界への有限CSS transition | 不採用。invalid解除時に旧意味色から補間される反例を確認。CSSとMotionの二系統管理も増える |
| Motionのhover gesture | 不採用。押下中のleaveをreleaseまで遅らせ、外へ出た面の強調が残ることを確認 |
| nativeのpointer観測＋Motionのhover量補間 | 採用。進入・離脱・cancelだけを観測し、実行・keyboard・選択・focusを再実装しない |

[useSurfaceFeedback](../apps/web/src/shared/ui/motion/useSurfaceFeedback.ts)がMotionの数値を0〜1で補間し、`styleEffect`が内部CSS変数へ投影する。CSSは意味に対応した色対を`color-mix(in oklab, …)`で描画する。意味色そのものを補間元として保存しないため、hover途中でもinvalidの発生・解除を即時に表せる。直接CSS変数をanimateする試作で見つけた設定変更後の遅延paint競合は、Motion valueと即時更新の接続へ修正した。

`domMin`を維持し、有限CSS transitionの例外や自作press gestureは追加していない。接続は既存DOM自身のrefで行い、wrapper・icon欄・余白は増やさない。動きを減らす設定の実行中変更、外部refの接続・cleanup、中断も共通接続が所有する。型契約で時間・easing等の公開を防ぎ、標準lintで命令的Motion APIを共通moduleへ限定した。

## 4. 接続結果

| 入口 | 結果・守った境界 |
| --- | --- |
| Button / LinkButton / IconButton / IconLink | 適用済み。native要素、disabled link、form pendingを維持 |
| DataTableの行・sort button | 適用済み。行は弱いhoverのみ。子操作へのhover量の継承を防止 |
| Controlのinput / select / textarea | 適用済み。invalid / review / warning / success等の意味色を保持 |
| Tabs / SegmentedControl | 適用済み。Base UI / nativeの選択・keyboard・focusと既存indicatorを維持 |
| ChoiceList / CheckboxField | 適用済み。選択面とlabelの反応を接続し、fieldset disabledと付随操作を維持 |
| Disclosure | triggerへ適用済み。panel・開閉判断・矢印のMotionを維持 |
| GlobalNav | 適用済み。現在地の面・境界・URL・横スクロールを維持 |
| AuthPanel | button recipeを使う外部linkへ接続済み。認証処理は維持 |
| featureの独自表現 | 試合の案内・分析内の本文linkは下線等を維持し対象外。OCRのdrag cursorも対象外。対象部品の接続を外すfeature側render差替えは見つからなかった |

共通部品の利用を通じて、試合・開催・戦績比較・OCR・出力・管理・設定・アカウントへ展開した。featureへ反応のpropsや調整値を配布していない。query、cache、フォームの処理、Suspense、Toastの判断は変更していない。

## 5. 検証結果と範囲

- format・lint・typecheck・production build、選択したunit / component test 63ファイル239件が通過。色対の通常・hover・pressedとOklab補間途中の文字contrastを検証した。production CSSに必要なtoken・状態styleが残ることも確認した。
- Playwright MCPで、実際の試合一覧の面・文字・寸法、行と子操作の分離、focus ring、途中反転を確認。動きを減らす設定を途中で変更した後も最終色へ収束することを3回確認した。
- 出力画面のtab選択とkeyboard、開催選択dialogのradio選択・focus復帰をPlaywright MCPで確認。独立した再現例ではinvalidの発生・解除、途中の無効化、押下中の逸脱、touch由来のpointer進入の除外を確認した。
- ChromeでOCRの320 / 390px表示と開閉、戦績比較の切替後の局所待機から結果への到達、配信用ビルドの認証画面を追加確認した。狭幅確認はviewport変更であり、実touch端末の検証ではない。
- 同条件のproduction buildでJavaScript資産のgzip合計は約3.1kB増加。全chunkの合計であり、初回ロードの増分や端末性能を表す値ではない。色の更新をcompositorのみの処理と仮定しない。
- 既存UI conformance E2Eへ、面の反応中の文字・寸法と動きを減らす設定の途中変更を確認する回帰stepを追加した。Playwright MCPの接続が途中で切れたため、追加後のspec全体は未実行。出力の通信待機・download完了と実touch端末操作は今回のbrowser検証では未確認。認証先への遷移も実行していない。

共有部品への接続に未解決箇所はない。上記の未確認範囲を通過扱いにせず、既存の業務操作testと実際に観測したbrowser経路を区別する。今後時間・色対・接続方式を変える場合は、今回の比較と影響する利用者契約を再確認する。
