# 操作する場所の輪郭を整える実施計画

## 1. 位置付けと今回の成果

採用案の観点1「輪郭は、操作の場所だけ少し明瞭にする」を具体化する。観点2の面の反応、観点3の待機表示・通知、戦績比較ヘッダの標準余白への修正は維持する。今回は計画の作成であり、製品コードへの適用はまだ行っていない。

目指す像は、白に近い面と現在の文字階層を保ち、入力できる場所と現在の操作先が迷わず分かる状態である。薄い線を一律に濃くするのではなく、識別に必要な輪郭、操作を補助する輪郭、内容を区切る線を分ける。通常時の大きさ・角丸・余白・文字・配置を変えず、1pxの既存境界の色を中心に整える。

表示契約の正本は [UI規約](ui-rule.md)、実装境界は [architecture](architecture.md#client-lifecycle--suspense--motion)、検証の選定は [test-rule](test-rule.md#4-web-evidence-catalog)。本書には実装差分・判断・順序を置き、恒久ルールは実施時に正本へ反映する。

## 2. 現状から分かったこと

| 実装入口 | 現状と問題 | 計画上の扱い |
| --- | --- | --- |
| [Control](../apps/web/src/shared/ui/forms/Control.tsx) | input / select / textareaの通常枠が、区切り線と共通の`color-border`。toneとinvalidの枠は意味色に個別の透明度を掛けている | 入力場所の境界を専用の意味トークンへ分離し、通常と意味状態の両方を確認 |
| [ChoiceList](../apps/web/src/shared/ui/forms/ChoiceList.tsx) | native radioを視覚的に隠し、独自の丸印を描く。未選択の丸印が`color-border-strong`で薄い。選択済みにはcheckと文言がある | 丸印の識別を改善。候補一覧の外枠・区切り線とは分ける |
| [actionRecipes](../apps/web/src/shared/ui/actions/actionRecipes.tsx) | secondary button / icon actionの枠も`color-border`。primary / dangerはすでに塗りで識別でき、quietは枠を持たない | 枠付きの副操作だけを小幅に調整する |
| [DataTableBodyRow](../apps/web/src/shared/ui/data/DataTable.tsx) | 行には弱いhoverがあるが、子のfocusに連動する行の表示はない | 子のfocus枠を残し、読んでいる行を補助する |
| focusの表示 | 全体は3px・offset 3px。Tabs、選択label、sort等には2pxまたは内側へ描く指定がある | 太さを一律変更せず、用途と切れ・重複を確認して共通部品側で修正 |
| [ChoicePickerDialogField](../apps/web/src/shared/ui/forms/ChoicePickerDialogField.tsx) | 値の表示と「変更」buttonを一つの枠で囲むが、枠全体はclickableではない | 外側を入力欄と同じ強さへ機械的に変更しない。実際に押すbuttonの境界を扱う |
| [色の検証](../apps/web/src/shared/ui/colorContrast.test.ts) | 文字・図表・面の補間は検証しているが、半透明の境界と実背景の合成を検証していない。変換関数はalphaを保持しない | 既存の通過を枠の識別性の保証に使わず、今回の色対と合成経路を検証へ加える |

標準の`color-surface`上でsRGBへ変換・alpha合成した計算では、通常枠は約1.27:1、未選択radioの枠は約1.57:1だった。toneの枠も一律には扱えず、action / success / warningの現在の透明度では同じ背景に対して3:1未満になる。これは定義値からの計算であり、全画面・全状態の実測や適合監査ではない。出力の候補dialogでは、独自radioの未選択枠がこの定義を使うことをChromeで確認した。

## 3. 根拠と適用する範囲

[WCAG 1.4.11の説明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)に基づき、入力場所や選択状態を識別するために必要な視覚情報は、実際の隣接色に対して3:1以上を確保する。丸めて合格にせず、hoverや意味状態の面が重なる場合も失わない。境界がなくても文字・icon・文脈から操作を識別できるbuttonの全周や、補助的なhover背景へ一律に3:1を要求する規則にはしない。

focusは既存の明瞭な枠を基準とする。[Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)と[Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)を確認し、scrollやsticky領域で操作先を見失わせない。2px相当面積の条件は[Focus AppearanceのAAA基準](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)であり、AAの必須数値として混同しない。既存規約に従い、枠の切れを直すために個別画面へ余白補正を散らさない。

「少し明瞭に」は固定の明度差を全要素へ加える意味ではない。入力の識別に足りない箇所は必要な強さまで直し、装飾や区切りは現状の静かさを保つ。入力枠は現状との差が比較的大きくなり得るため、密な試合編集画面も含めて色対の試作を比較する。

## 4. 具体的な実施内容

### A. 入力欄と選択マークの輪郭

- `styles.css`に入力境界の意味トークンを設け、通常のinput / select / textareaと、独自に描く未選択radioの丸印へ接続する。一般の`color-border` / `color-border-strong`の値は変えない。
- 通常色の試作は既存neutralの色相・低彩度を保ち、不透明な1px線を第一候補とする。標準surface / canvas上の候補はOKLCHのL=64%・C=0.018・H=250から比較する。この候補の計算値は約3.26 / 3.13:1だが、選択面など全背景では同じ基準を満たさないため確定値にはしない。
- 候補値は、実際に接する背景の棚卸し→contrast確認→標準入力と密な編集画面の比較、の順で確定する。必要な背景で合格する候補から最も控えめな値を選ぶ。全背景へ無条件で使える色を作るために通常線を過度に濃くしない。
- action / review / success / warning / invalidは現在の意味色を保ち、枠の透明度を含む色対を共通定義にまとめる。invalidの発生・解除、hover中のtone変更でも新しい意味の枠へ即時に変わる。focusでerror枠を通常色へ戻さない。
- hoverは観点2の面だけで返す。通常枠を濃くした上で、hoverの枠強調や内側shadowを重ねない。境界の幅を増減して寸法を動かさない。
- disabled / pendingは既存の操作抑止と減光を維持し、通常時と同じ強さを強制しない。readOnlyは文字選択・copy・focusを保ち、disabledと同じopacityへ落とさない。native checkboxは独自描画へ置き換えず、標準状態とforced colorsでの見え方を確認する。

### B. 枠付き副ボタンの輪郭

secondaryのButton / LinkButton / IconButton / IconLinkの既存枠を、現在の`color-border-strong`相当まで一段だけ明瞭にする。枠付きの副ボタンも対象にする方針はユーザー確認済み。標準surface上の計算では約1.27→1.57:1となる。これはbuttonの識別を補助する設計値であり、入力境界の3:1基準の代わりではない。

副操作用の意味トークンへ接続し、入力線と同一の強さにはしない。primary / dangerの塗り、quiet / dangerQuietの枠なし、disclosure / tab / navの常時表示は維持する。compound fieldの外枠やpaginationの件数表示へ副操作用トークンを広げない。

### C. 一覧内でフォーカスを追う補助

DataTableの子操作が`:focus-visible`に一致する間だけ行へ薄い背景を即時表示する。キーボードのフォーカス表示へ連動する方針はユーザー確認済み。色は観点2の弱い行hoverと同じ強さを出発点に、行focus用の意味として共通定義する。子buttonのfocus枠が操作先を示し、行背景はそのbuttonと行の内容を結び付ける補助に限定する。

- 行そのものへfocus枠、tabIndex、click handler、pointer cursor、選択状態を追加しない。キーボードの移動順も変えない。
- hoverとの重複で二重に暗くせず、focusがある間は同じ一つの面として描く。focusが抜けたら現在のpointer位置に応じたhoverへ戻る。focus取得・解除へ100msの補間や最低表示時間を追加しない。
- `:focus-visible`は厳密な「最後の入力がkeyboardだったか」の自作判定ではない。browserの判断に従い、文字入力や利用者の常時focus表示設定ではpointer操作後も表示され得る。[Selectors仕様の説明](https://www.w3.org/TR/selectors-4/#the-focus-visible-pseudo)
- dialogが開きfocusが移ったとき、行の削除・再描画・無効化時に古い行を保持しない。子孫selectorによる静的表示を第一候補とし、Reactへfocused rowのstateを追加しない。
- 対象は共有DataTableのデータ行。試合編集のScoreGridは独自の編集構造であり、今回DataTableへ移し替えない。モバイルのrecord全体へ新しい面を付ける変更も対象外で、内部操作のfocusを確認する。

### D. フォーカス枠の接続確認

既存の3px枠を基準に、input、button/link、radio label、tabs、sort、disclosure、dialog内と横scroll内を点検する。隣接操作との衝突、outlineの切れ、隠したinputとlabelによる二重描画があれば、所有するshared primitiveまたはscroll領域で修正する。既存の内側枠・2px枠には用途上の理由を確認し、単なる数値統一のための変更はしない。

forced colorsでは実行対象と選択・focusを識別できることを確認し、通常色を強制して利用者の色設定を妨げない。行背景が省略されても子のfocus枠と操作は成立させる。

## 5. デザインシステムから画面への接続

| 所有者 | 担当する変更・対象外 |
| --- | --- |
| `styles.css` | 参照色→入力境界・副操作境界・行focusの意味トークン。一般の区切り線、面、文字、順位・メンバー色は維持 |
| `Control`、`ChoiceList` | 現行のtone / invalid / disabled / selectedから境界を選択。候補一覧外周ではなく識別用マークを対象にする |
| `actionRecipes` | Bの4つの副操作経路。新しいbutton variantや境界の強さpropsは公開しない |
| `DataTableBodyRow` | Cの表示条件と行面。親rowと子操作の意味を分離し、Motionのhover量を上書きしない |
| 既存focus・scrollのowner | 必要な場合だけ切れ・重複を修正。featureへ任意のoutline値や余白補正を配布しない |
| feature | 試合・開催・比較・OCR・出力・設定・管理・認証の既存部品を通じて適用。独自の枠は意味を確認して接続／維持を記録 |

新しい依存、provider、Motion feature、有限CSS transitionの例外は不要。今回追加する輪郭・focus連動は静的な状態表示とし、観点2のhover補間だけが既存Motion接続を使う。token値を一度選ぶための計算をruntimeの色生成機構にはしない。

## 6. 反例による見直し

| 起こり得る問題 | 防ぎ方 |
| --- | --- |
| 全borderを変更し、カードや表の線まで目立つ | 一般tokenを据え置き、操作の役割へ新しいtokenを接続 |
| 淡さを優先して入力場所が見分けられない | 必要な境界のcontrastを先に満たし、面積・本数・彩度で控えめさを保つ |
| 枠・hover・focusが全部同時に濃くなる | hoverは面、focusは既存枠、通常境界は固定。hover専用の枠を増やさない |
| 選択候補の外枠やcompound field全体がclickableに見える | 実際に操作するmark / buttonへ限定し、周辺の構造線は維持 |
| 行が選択済みに見える、クリック後に帯が残る | `:focus-visible`へ連動し、選択状態を追加しない。子のfocus枠を主表示にする |
| 行内にbackground付きcellがあり、帯が途中で切れる | consumerの実際のcellを点検。独自編集表へ無理に展開せず、共通部品の範囲で判断 |
| 数値テストがalphaを落として合格する | 色の合成を扱う検証とbrowserの実際の状態を組み合わせる |
| 基盤を複雑にするわりに差が小さい | 既存部品と静的な状態selectorへ閉じ、設定可能な汎用boundary componentを作らない |

## 7. 実施順序と完了条件

| 段階 | 実施内容 | 完了条件・コミット単位 |
| --- | --- | --- |
| 1 | 境界色の比較 | 確定した範囲でinput・tone・未選択radio・副buttonの実背景を棚卸し、候補とcontrastを比較。密な試合編集と通常formで過剰な線を避ける |
| 2 | 入力境界と選択マーク | 参照色・意味token・Control・ChoiceListへ適用。通常／意味状態／hover／disabled／readOnlyを確認し、規約と色の検証を含めてコミット |
| 3 | 副操作と行focus・focus枠 | B / Cを実装。既存の移動順・click・scroll・dialog focus復帰を確認し、shared接続単位でコミット |
| 4 | 横展開と回帰確認 | 接続／対象外の対応表を確定。狭幅、密な編集、補間中の状態変更、forced colorsを確認。検出した問題を修正してコミット |
| 5 | 文書整理と報告 | 採用値、適用範囲、判断根拠、gateと未検証範囲を記録。UI規約を正本とし、本書を実施結果へ整理 |

検証は失敗条件に応じた代表例を選び、全状態×全画面の総当たりにはしない。

- 色: 必要な境界・選択マーク・focusの隣接色contrast、半透明の合成、hover途中とtone / invalidの両方向の変更。文字の既存基準も維持する。装飾線や補助的な行背景を誤って3:1の対象にしない。
- 操作: native input / select、独自radio、button / link、Base UI trigger、sortの既存契約。Tab / Shift+Tab、Enter / Space、pointer、disabled / readOnly、dialogへの移動と復帰を確認する。
- 実画面: 試合一覧・開催・管理の行内操作、試合編集の通常／要確認／エラー入力、出力の選択dialog、比較のfilter / tabsを代表に320 / 390 / 1440pxで確認。通常寸法、折り返し、scroll、focusの見失いと線の密度を評価する。
- 自動検証: 既存の色検証を合成に対応させ、影響する部品・業務操作のtestを選ぶ。CSS class一致やjsdom寸法で見た目を代用せず、field数と同数の重複snapshotは作らない。
- gate: format、lint、typecheck、選択したunit / component test、production buildでtoken・selectorの保持確認、影響する主要flowのPlaywright。目視はPlaywright MCPまたはChromeを使う。未接続・未実行を通過扱いにせず、未確認条件を記録する。文書のみの現段階は`git diff --check`と`pnpm public:safety:check`。

## 8. 確定事項と実施時の判断

1. 行背景の表示条件: ユーザー回答「キーボードのフォーカス表示に連動する」に従い、子の`:focus-visible`へ連動する。
2. 枠付き副ボタンの範囲: ユーザー回答「枠付きの副ボタンも少し明瞭にする」に従い、Bを実施する。

対象範囲の確認待ちはない。境界の太さ・角丸・余白を保つこと、通常枠と意味枠を分けること、必要な識別性を確保することは既存規約と目的に沿って計画に含めた。具体色の最終値は実施段階の比較で決める技術上の検証事項であり、未確認の最適値として断定しない。
