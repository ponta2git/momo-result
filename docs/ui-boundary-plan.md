# 操作する場所の輪郭を整える実施記録

## 1. 位置付けと今回の成果

採用案の観点1「輪郭は、操作の場所だけ少し明瞭にする」を具体化する。観点2の面の反応、観点3の待機表示・通知、戦績比較ヘッダの標準余白への修正は維持する。入力・選択マーク・枠付き副操作の境界と、実focusに連動する行の補助を共通部品へ実装した。管理一覧の固定名前セルが既存hoverを遮る不具合は先行修正済み。実装、自動検査、Chromeでの代表画面確認を終え、接続復旧後のPlaywright MCPで影響する主要flowのE2Eも確認した。

目指す像は、白に近い面と現在の文字階層を保ち、値を扱う部品、実行する操作、現在の操作先が迷わず分かる状態である。薄い線を一律に濃くするのではなく、識別に必要な輪郭、操作を補助する輪郭、内容を区切る線を分ける。通常時の大きさ・角丸・余白・文字・配置を変えず、1pxの既存境界の色を中心に整える。

敵対的レビューで、前案の「各部品を明瞭にすれば全体も使いやすくなる」という不足を見直した。観点2と同じ状態の分け方を用い、操作中・関連内容・その他のUIをつなぐ表示の範囲、複数状態の同時表示、終了後の戻り方までを本計画の完了条件に含める。レビューで既存コードを確認した事実と、未実装の案に対する反例、今後の利用者検証を区別する。

表示契約の正本は [UI規約](ui-rule.md)、実装境界は [architecture](architecture.md#client-lifecycle--suspense--motion)、検証の選定は [test-rule](test-rule.md#4-web-evidence-catalog)。本書には採用時の判断、実装差分、検証結果を置き、恒久ルールは正本へ反映した。3〜6章は合意した設計と反証条件、7章は実施結果を記録する。

後続の全体点検で、入力欄と選択欄の枠の差が不統一に見えるという指摘を受けた。以下のselect専用の薄い枠は採用当時の判断であり、現在はその薄い参照色を通常の入力・選択欄全体へ適用している。テキスト・数値・日時・textarea・一行selectに加え、dialog型選択欄と選択肢groupも共通境界へ接続した。独自選択マークと意味状態の境界は識別性を保つ別tokenへ分離し、表示契約はUI規約へ更新した。

## 2. 着手時の調査結果

| 実装入口 | 着手時の状態と問題 | 採用した扱い |
| --- | --- | --- |
| [Control](../apps/web/src/shared/ui/forms/Control.tsx) | input / select / textareaの通常枠が、区切り線と共通の`color-border`。toneとinvalidの枠は意味色に個別の透明度を掛けている | 入力場所の境界を専用の意味トークンへ分離し、通常と意味状態の両方を確認 |
| [ChoiceList](../apps/web/src/shared/ui/forms/ChoiceList.tsx) | native radioを視覚的に隠し、独自の丸印を描く。未選択の丸印が`color-border-strong`で薄い。選択済みにはcheckと文言がある | 丸印の識別を改善。候補一覧の外枠・区切り線とは分ける |
| [actionRecipes](../apps/web/src/shared/ui/actions/actionRecipes.tsx) | secondary button / icon actionの枠も`color-border`。primary / dangerはすでに塗りで識別でき、quietは枠を持たない | 枠付きの副操作だけを小幅に調整する |
| [DataTableBodyRow](../apps/web/src/shared/ui/data/DataTable.tsx) | 行には弱いhoverがあるが、子のfocusに連動する行の表示はない | 子のfocus枠を残し、読んでいる行を補助する |
| [AdminAccountRow](../apps/web/src/features/masters/accounts/AdminAccountRow.tsx) | 固定名前セルの独自のsurface色が既存の行hoverを遮っていた。共有行を不透明にし、固定セルがその背景を継承するよう修正済み | 新しい行focusも同じ接続を使う。不透明性を保って横scroll時の内容の透けを防ぐ |
| focusの表示 | 全体は3px・offset 3px。Tabs、選択label、sort等には2pxまたは内側へ描く指定がある | 太さを一律変更せず、用途と切れ・重複を確認して共通部品側で修正 |
| [ChoicePickerDialogField](../apps/web/src/shared/ui/forms/ChoicePickerDialogField.tsx) | 値の表示と「変更」buttonを一つの枠で囲むが、枠全体はclickableではない | 外側を入力欄と同じ強さへ機械的に変更しない。実際に押すbuttonの境界を扱う |
| [色の検証](../apps/web/src/shared/ui/colorContrast.test.ts) | 文字・図表・面の補間は検証しているが、半透明の境界と実背景の合成を検証していない。変換関数はalphaを保持しない | 既存の通過を枠の識別性の保証に使わず、今回の色対と合成経路を検証へ加える |

標準の`color-surface`上でsRGBへ変換・alpha合成した計算では、通常枠は約1.27:1、未選択radioの枠は約1.57:1だった。toneの枠も一律には扱えず、action / success / warningの現在の透明度では同じ背景に対して3:1未満になる。これは定義値からの計算であり、全画面・全状態の実測や適合監査ではない。出力の候補dialogでは、独自radioの未選択枠がこの定義を使うことをChromeで確認した。

## 3. 根拠と適用する範囲

[WCAG 1.4.11の説明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)に基づき、入力場所や選択状態を識別するために必要な視覚情報は、実際の隣接色に対して3:1以上を確保する。丸めて合格にせず、hoverや意味状態の面が重なる場合も失わない。境界がなくても文字・icon・文脈から操作を識別できるbuttonの全周や、補助的なhover背景へ一律に3:1を要求する規則にはしない。

focusは既存の明瞭な枠を基準とする。[Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)と[Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)を確認し、scrollやsticky領域で操作先を見失わせない。2px相当面積の条件は[Focus AppearanceのAAA基準](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)であり、AAの必須数値として混同しない。既存規約に従い、枠の切れを直すために個別画面へ余白補正を散らさない。

「少し明瞭に」は固定の明度差を全要素へ加える意味ではない。入力の識別に足りない箇所は必要な強さまで直し、装飾や区切りは現状の静かさを保つ。入力枠は現状との差が比較的大きくなり得るため、密な試合編集画面も含めて色対の試作を比較する。

### 3.1 「反応の文法」との接続

観点1を新しい反応体系にはしない。[観点2の四つの軸](ui-rule.md#操作面の反応)へ次のように接続する。focus、pressed、selected、pendingを一つの「active」状態へまとめない。

| 軸 | 読み取れる意味 | 観点1で扱う表示 | 観点2・3との接続 |
| --- | --- | --- | --- |
| 操作可能性 | 今できること・できないこと | 通常の部品境界、既存のdisabled / readOnlyの区別 | 非フォーカスは無効を意味しない。制限は業務状態とnative / Base UIを正本にし、hoverや行背景から判定しない |
| 意味の基底 | 選択、現在地、要確認、エラー等 | 役割に対応した通常枠・意味枠 | 意味色・印・文言はfocusが外れても残る。状態変更はhover途中でも即時に反映 |
| 一時的な反応 | pointerが乗る・押す | 今回は新しい枠の変化を足さない | 既存の面のhoverは100ms、pressedは即時。nav・underline tabの既存の境界反応も維持 |
| focus | keyboard等の操作先 | 既存focus枠と、それに連動する行の補助背景 | 表示・解除は即時。実focusの移動・復帰をnative / Base UI / 既存の待機制御へ残し、装飾側で記憶しない |

一つの部品では、境界が役割と意味を、面が一時的な反応を、focus枠が操作先を示す。通常境界とfocus枠の併存は役割の異なる表示であり、同じ境界を親子で二重に描くこととは区別する。focusを目立たせるためにerror枠を消したり、周囲の通常入力を薄くしたりしない。

補間するのは既存のhover量だけ。新しい枠色と行focusを同じ補間へ含めず、focus由来の行表示を外した後は**その時点の**hover表示へ戻す。pointerが既に離れていれば既存の解除補間だけが残り得るが、最後のfocus行を保持・再生するtimerは作らない。

### 3.2 操作していないUIとの関係

「操作していない」を一つの見た目へ潰さず、次に必要な情報と操作可能性を保つ。

| 操作対象との関係 | 保つもの・変える範囲 | 避ける誤認 |
| --- | --- | --- |
| 他の操作可能な入力・button | 同じ役割には同じ通常境界。自身のhover / focusには通常どおり応答 | 非フォーカスだから無効、次の操作が使えない |
| 同じ行の対象名・値・状態 | 配置と文字階層を保ち、行の薄い面だけで対応を補助。子操作だけがfocus枠を持つ | 行全体が実行対象・選択済みである |
| 選択済みの別項目、現在地、他のエラー | 意味の印・色・文言を保持。focusが移ったことでは解除しない | focusを移すだけで選択や問題が解消した |
| 関連する説明・単位・出典画像 | 既存のlabel関係、整列、説明と業務上の連動を保持 | 強調されたcontrolだけでは対象や単位が分からない |
| 無関係な内容 | 位置・文字・面・操作可能性を変更しない | spotlight、全体減光、blurによる見え方や利用可否の変化 |
| 業務上の依存がある内容 | filter変更によるinert、取得結果、局所エラー等は既存のownerが更新 | 見た目の統一を理由に必要な保護や結果表示を止める |

例えば試合編集の数値入力は、focus時に対応する出典画像や要確認セルの文脈を更新する既存処理を持つ。この意味のある連動は保ち、全ての非操作UIを静止させる規則にはしない。同時に、行の補助表示をScoreGrid全体や出典画像の新しい発光・囲みへ広げない。

一つの行にkeyboard focus、別の行にpointerがある場合は、focus枠を持つ操作先と弱いhoverが併存してよい。全画面で一つだけの「操作中の面」を選ぶstateや入力方式の切替modeは作らない。同じ行でhoverとfocusが重なる場合は面を加算しない。両者の併存で実行対象を読み違えるなら、先に行面の強さと対象名までの連続性を見直す。

目指す見え方は、普段は同じ役割の入口が同じ強さで読め、操作時には子のfocus枠から対象名までを追え、移動後は選択・エラー等の意味だけが必要な場所に残る状態である。行の補助背景が見えにくい環境でも、子のfocus枠と表の見出し・整列で対象を確認できることを保つ。

## 4. 具体的な実施内容

### A. 入力欄と選択マークの輪郭

- `styles.css`に入力境界の意味トークンを設け、通常のinput / select / textareaと、独自に描く未選択radioの丸印へ接続する。一般の`color-border` / `color-border-strong`の値は変えない。
- 通常色の試作は既存neutralの色相・低彩度を保ち、不透明な1px線を第一候補とする。標準surface / canvas上の候補はOKLCHのL=64%・C=0.018・H=250から比較する。この候補の計算値は約3.26 / 3.13:1だが、subtle面では約2.993:1となり不採用。実装ではL=63.5%へ調整した。
- 候補値は、実際に接する背景の棚卸し→contrast確認→標準入力と密な編集画面の比較、の順で確定する。必要な背景で合格する候補から最も控えめな値を選ぶ。全背景へ無条件で使える色を作るために通常線を過度に濃くしない。
- action / review / success / warning / invalidは現在の意味色を保ち、枠の透明度を含む色対を共通定義にまとめる。invalidの発生・解除、hover中のtone変更でも新しい意味の枠へ即時に変わる。focusでerror枠を通常色へ戻さない。
- 入力のhoverは観点2の面だけで返す。通常枠を濃くした上で、hoverの枠強調や内側shadowを重ねない。境界の幅を増減して寸法を動かさない。非フォーカスの入力にも同じ通常枠を使い、初めて触れる前と次の入力へ移った後の発見可能性を保つ。
- disabled / pendingは既存の操作抑止と減光を維持し、通常時と同じ強さを強制しない。readOnlyは文字選択・copy・focusを保ち、disabledと同じopacityへ落とさない。native checkboxは独自描画へ置き換えず、標準状態とforced colorsでの見え方を確認する。

### B. 枠付き副ボタンの輪郭

secondaryのButton / LinkButton / IconButton / IconLinkの既存枠を、現在の`color-border-strong`相当まで一段だけ明瞭にする。枠付きの副ボタンも対象にする方針はユーザー確認済み。標準surface上の計算では約1.27→1.57:1となる。これはbuttonの識別を補助する設計値であり、入力境界の3:1基準の代わりではない。

副操作用の意味トークンへ接続し、入力線と同一の強さにはしない。primary / dangerの塗り、quiet / dangerQuietの枠なし、disclosure / tab / navの常時表示は維持する。compound fieldの外枠やpaginationの件数表示へ副操作用トークンを広げない。

### C. 一覧内でフォーカスを追う補助

DataTableの子操作が`:focus-visible`に一致する間だけ行へ薄い背景を即時表示する。キーボードのフォーカス表示へ連動する方針はユーザー確認済み。色は観点2の弱い行hoverと同じ強さを出発点に、行focus用の意味として共通定義する。子buttonのfocus枠が操作先を示し、行背景はそのbuttonと行の内容を結び付ける補助に限定する。

- 行そのものへfocus枠、tabIndex、click handler、pointer cursor、選択状態を追加しない。キーボードの移動順も変えない。
- hoverとの重複で二重に暗くせず、focusがある間は同じ一つの面として描く。focusが抜けたら現在のpointer位置に応じたhoverへ戻る。focus取得・解除へ100msの補間や最低表示時間を追加しない。
- `:focus-visible`は厳密な「最後の入力がkeyboardだったか」の自作判定ではない。browserの判断に従い、文字入力や利用者の常時focus表示設定ではpointer操作後も表示され得る。[Selectors仕様の説明](https://www.w3.org/TR/selectors-4/#the-focus-visible-pseudo)
- dialogが開いてfocusが移ったとき、行の削除やnative disabled / inert化でfocusを失ったときは、focus由来の行表示を保持しない。dialogを閉じた後は実際に戻ったfocusへ追従する。再描画でも同じDOMのfocusが保たれるなら行表示も保つ。子孫selectorによる静的表示を第一候補とし、Reactへfocused rowのstateを追加しない。
- focusを保持できるaria-disabled等の経路では、実際のfocusを見えなくしない。`aria-busy`だけで行をfocus中に見せたり、反応を全部消したりしない。子操作が一つdisabledになったことを、別の子操作や行の読取り全体の無効化へ広げない。既存の`.momo-surface:has(input:disabled)`はlabel ownerに限定し、disabledの子inputが行全体の読取り反応を抑止しないよう修正した。
- 管理のアカウント行では、既存hoverを遮る固定名前セルの不具合を修正済み。DataTable側の不透明な行背景を固定セルが継承する接続へ、新しいfocus表示も載せる。個別セルへ別の時間・状態selectorを複製しない。単純な透明化では横scroll時に背後の文字が透けるため、不透明性を維持する。対象名に届かない帯を「適用済み」にしない。
- 対象は共有DataTableのデータ行。試合編集のScoreGridは独自の編集構造であり、今回DataTableへ移し替えない。モバイルのrecord全体へ新しい面を付ける変更も対象外で、内部操作のfocusを確認する。

### D. フォーカス枠の接続確認

既存の3px枠を基準に、input、button/link、radio label、tabs、sort、disclosure、dialog内と横scroll内を点検する。隣接操作との衝突、outlineの切れ、隠したinputとlabelによる二重描画があれば、所有するshared primitiveまたはscroll領域で修正する。既存の内側枠・2px枠には用途上の理由を確認し、単なる数値統一のための変更はしない。実装ではChoiceListの隠したradioの枠を可視labelへ一本化した。末尾の編集・削除操作は、右端のoutlineが切れることをChromeで確認し、同じ共有部品内で3pxの内側outlineへ修正した。

forced colorsでは実行対象と選択・focusを識別できることを確認し、通常色を強制して利用者の色設定を妨げない。行背景が省略されても子のfocus枠と操作は成立させる。

### E. 操作の開始から復帰までの合成条件

| 場面 | 現在の対象 | 周囲と終了後の表示 |
| --- | --- | --- |
| 入力AからBへTabで移動 | Bのfocus枠を即時表示 | Aの通常／意味枠・値・エラーは保持。Aのfocusだけを外す |
| 行内の別buttonへTab移動 | 子のfocus枠が移る | 同じ行の帯は維持し、点滅・再生しない。次の行へ移れば帯のownerも移る |
| 一方の行がfocus、別の行がhover | focus枠が実行先を示す | 薄い行面は併存可能。pointerを動かしてfocusの行を無効化しない |
| hover中にinvalid / selectedが変更・解除 | 枠・印・文言は新しい意味へ即時更新 | hover量だけを引き継ぎ、旧意味色や旧選択を残さない |
| keyboard操作で処理を開始 | 既存のpending文言と抑止を表示 | native disabledでfocusが外れても、進行中の場所は文言と安定した位置で分かる。偽のfocus枠や処理中の行帯を追加しない |
| 別の操作がまだ実行可能 | 自身の通常／focus契約を維持 | 複数の独立処理を一つのactive判定にしない。通知と待機の担当は観点3のownerを維持 |
| dialogを開く・閉じる | focusはdialog内、閉じた後は既存の復帰先 | 背後にfocus帯を残さず、戻った実focusから表示を決める。新しい自動scrollや強調timerを加えない |
| scope変更で古い内容をinertにする | 安全な操作欄・局所待機を維持 | 旧内容の色や値を消して保護を代用しない。復帰は既存StaleShieldに従い、利用者が別の場所へ移したfocusを奪わない |
| pointer / touchだけで操作 | pointerは既存hover、touchはnative押下と結果 | focus表示の発生はbrowserの判断に従う。touch向けにhoverを作らず、常時の境界で入口を識別できる |

この表は検証用の状態組合せであり、新しい共通state machineを作る指示ではない。

## 5. デザインシステムから画面への接続

| 所有者 | 担当する変更・対象外 |
| --- | --- |
| `styles.css` | 参照色→入力境界・副操作境界・行focusの意味トークン。一般の区切り線、面、文字、順位・メンバー色は維持 |
| `Control`、`ChoiceList` | 現行のtone / invalid / disabled / selectedから境界を選択。候補一覧外周ではなく識別用マークを対象にする |
| `actionRecipes` | Bの4つの副操作経路。新しいbutton variantや境界の強さpropsは公開しない |
| `DataTableBodyRow`と固定見出しセルの共有接続 | Cの表示条件と行面を一つのownerで決定。親rowと子操作の意味を分離し、Motionのhover量を上書きしない。固定セルは最終の不透明な行面へ接続 |
| 既存focus・scrollのowner | 必要な場合だけ切れ・重複を修正。featureへ任意のoutline値や余白補正を配布しない |
| feature | 試合・開催・比較・OCR・出力・設定・管理・認証の既存部品を通じて適用。独自の枠は意味を確認して接続／維持を記録 |

新しい依存、provider、Motion feature、有限CSS transitionの例外は不要。今回追加する輪郭・focus連動は静的な状態表示とし、観点2のhover補間だけが既存Motion接続を使う。token値を一度選ぶための計算をruntimeの色生成機構にはしない。

## 6. 敵対的レビューとUX上の判定

| 起こり得る問題 | 防ぎ方 |
| --- | --- |
| 未操作の入力を淡くすればfocusが目立つ | 却下。次に使える欄の発見を損なう。通常境界はfocusの有無で弱めず、focus枠だけを移す |
| 全borderを変更すれば一貫する | 却下。操作可能性と構造線の役割を混同する。一般tokenを維持し、必要な境界だけへ接続 |
| 行に薄い背景があれば対象を追える | 前案では不十分。管理の固定名前セルが既存hoverを遮る不具合をコードとChromeで確認し、先行修正した。追加するfocus帯も対象名まで同じ接続で表示する |
| 行focusを一つにすれば視線が迷わない | 一律抑止は不採用。別行のhoverも正当な反応であり、focus枠が実行先を示す。併存を実画面で検証し、行背景の競合を判断 |
| focusした状態を強くすればerrorも読みやすい | 却下。focusに伴う枠置換ではerrorの意味が消える。意味枠・文言とfocusを独立させ、focus外のerrorも維持 |
| 処理中も最後の行を強調すれば場所を保てる | 却下。focusとpendingの意味を混同する。既存の処理中文言・位置保持を使い、行表示は実focusに追従 |
| 値と変更buttonを囲む枠を強くすれば操作しやすい | 一律変更は不採用。枠全体がclickableに見える。実際のbuttonを整え、外側は値との関係を示す構造線として残す |
| readonly、disabled、非focusを同じ弱い色にする | 却下。copy・選択可能な内容や次の操作まで使えなく見える。各状態の意味と既存の制限を維持 |
| 3:1に達したので快適になった | 判定不能。識別の最低条件と、密度・対象の取り違え・操作継続の改善は別に検証する |
| CSS selectorだけなので状態競合はない | 却下。disabled子孫を含む行、固定cell、focus復帰との合成を検証する。判定をfeatureへ複製しない |

### 6.1 何をもってUXへの寄与とするか

[W3Cの認知アクセシビリティ補助指針](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/)は、慣れた一貫した操作と、controlが影響する内容との関係を明瞭にすることを勧める。本計画の根拠として使うが、行の帯や今回の色値の効果を証明する研究ではなく、WCAGの必須条件でもない。

| 施策 | 期待する寄与（仮説） | 反証となる観測 |
| --- | --- | --- |
| 入力・未選択radioの必要な境界 | 触る前に入力・選択の入口を発見し、次の欄へ移れる | 有効な次の欄を無効と見なす、密な枠が値やラベルの読取りを妨げる |
| 副buttonの小幅な境界強化 | 主操作との階層を保ちながら、取消・変更を探せる | 副操作が主操作より目立つ、外側の表示用枠を押そうとする |
| 行focusと対象名の連続性 | focusした操作がどの記録に作用するか確認しやすい | 別行を対象と思う、行全体を押せる／選択済みと解釈する |
| 周囲の意味・配置を維持 | 他のエラーや選択を参照し、処理後も次の操作へ戻れる | focus移動でエラーを見落とす、dialogから戻るたびに対象を探し直す |

実施時は同じ内容・条件で現行と候補を比較する。試合編集の「次に入力する欄を探す→入力→別の要確認欄へ移る」、一覧の「対象名を確認→行内操作へTab移動→別行へ移る」、出力の「現在値を読む→候補を選ぶ→元の欄へ戻る」を代表タスクにする。別行hover、非focusのerror、処理開始、横scrollも混ぜる。実行する内容を知らない人にも、実行対象・次に使える操作・残る問題を説明できる表示かを確認する。

エージェントの実画面レビューでは、対象名との対応、文字と枠の階層、残る意味、次の操作への到達を記録する。利用者テストが行える場合は、迷い・誤対象の選択・不要な再探索を観測する。操作時間や誤操作の減少は未測定で、意匠評価の点数をUX改善の実証として扱わない。「状態の説明」「規則の予測可能性」「反応の強さ」「初見の理解」は3.1・3.2・Eと上表の条件で評価する。

レビューでは既存規約・共有部品・利用箇所のコードを確認した。管理一覧の既存hoverの不具合はChromeで再現し、修正後は通常時と補間途中の行・固定セルの背景一致、390px幅での横scroll後の固定位置と不透明性を確認した。関連component test 10件、format、lint、typecheck、production buildは通過。Playwright MCPは未接続で、E2Eの証拠にはしていない。観点1の追加実装の確認結果は7章に記録する。利用者テストによる効果の実証は行っていない。

必須の識別性は維持した上で、仮説に反する結果が出れば反応面積・強さ・接続を先に直す。色の種類や新しいanimation、周囲の減光を追加して解決したことにしない。合意済みの対象範囲を外す必要が生じる場合だけ、具体的な失敗と代替案を示して再確認する。

## 7. 実施結果と検証範囲

### 実装と採用値

| 段階 | 結果 |
| --- | --- |
| 先行不具合修正 | `f812d2a5`。共有行を不透明にし、AdminAccountRowの固定名前セルを`bg-inherit`で接続 |
| 入力・選択マーク | `6cbb0772`。ControlとChoiceListへ境界tokenを接続。合成後の色検証とUI規約を更新 |
| 副操作・行focus | `1fda6a46`。4種のsecondary actionを接続し、共有行に`:has(:focus-visible)`の静的表示を追加。E2Eの回帰シナリオを追加し、接続復旧後に関係するflowをMCPで確認 |
| focus枠の修正 | `34a7bf7d`。ChoiceList末尾のbutton / linkを内側outlineにし、右端での切れを解消 |
| 横展開・記録 | 共通部品の接続先、代表画面、Playwright MCPでのE2Eを確認し、本書とUI規約へ反映 |

通常の入力境界は`oklch(63.5% 0.018 250)`。元のneutralの色相と低彩度を保った。標準surfaceで約3.329:1、canvasで約3.192:1、subtle / pressed面で約3.053:1、hover面で約3.142:1となる。L=64%候補がsubtle面で3:1を下回ることから、0.5ポイント下げた値を採用した。これは定義値の計算であり、最適な見やすさを測定した値ではない。

意味枠は元の意味色に対する不透明度をaction 75%、review 80%、success 80%、warning 95%、invalid 75%として専用tokenにした。tone面のnormal〜hoverを11点で計算し、surface / canvas / subtle上で内側・外側の隣接色に対し3:1以上、文字は4.5:1以上を検証する。境界はcontrol自身の半透明背景へ重ね、その背景を外側surfaceへ重ねる実際の合成順を使う。既存のopaque変換へalpha付き色を渡すと失敗させ、alphaの破棄による誤合格を防いだ。検証用の既知値として、白地に50%黒を合成したcontrastも確認する。

副操作の境界は従来の`color-border-strong`相当。行focusは弱い行hoverと同じneutral参照値を、行focus専用の意味tokenへ接続した。一般の区切り線、寸法、角丸、余白、文字階層は変更していない。新しいstate、provider、依存、transitionの例外は追加していない。

### 利用先への接続

| 接続先 | 結果・維持した境界 |
| --- | --- |
| Controlを使う試合編集・OCR確認・比較filter・出力・開催・管理・認証 | 通常とtone / invalidを共通tokenへ接続。disabled、readOnly、native select / checkboxの操作契約を維持 |
| ChoiceListを使う出力候補・管理の作品選択等 | 未選択radioの丸印を入力境界へ接続。選択のcheck・文言を維持し、labelがfocusを一つ所有 |
| Button / LinkButton / IconButton / IconLink | secondaryだけを専用tokenへ接続。primary、danger、quiet、dangerQuietは維持 |
| 試合・開催・管理等の共有DataTable | 子focusに追従する行面を一つのCSS ownerで接続。固定セルは同じ不透明面を継承 |
| ChoicePickerDialogField、ScoreGrid、native checkbox / file / range | 表示用外枠、編集構造、native描画を一律に入力境界へ置換しない。内部の既存Control / actionを通して適用 |
| Tabs / disclosure / sort / nav | 既存の構造、選択表示、focus、hoverの役割を維持。常時の枠を追加しない |

### 検証結果

- 入力・選択・色のtest 13件、action / form / DataTable / Dialog / StaleShield / 管理画面のtest 48件が通過。最終のChoiceList / ScoreGrid / ExportPage / HeldEventsPageのtest 52件も通過した。重複を含む各実行の件数であり、合計の独立test数ではない。
- 最終コードのformat、lint、typecheck、production buildが通過。built theme checkに加え、生成CSSに今回の8つの意味token、行focus selector、末尾操作の内側outline selectorが残ることを確認した。buildには既存の大きなchunkに関する警告が残る。
- Chrome: 1440pxの密な編集画面と320pxの入力移動を確認。入力値・ラベルの階層を保ち、通常枠とfocusを区別でき、他のinvalid表示が残る。320pxでページ全体の横はみ出しはなく、順位から総資産へTab移動できた。
- Chrome: 管理行のTab / Shift+Tab相当の行内移動、別行hoverとの併存、同じ行での非加算、dialogを開いたときの背景行focus解除とEscape後の実focus復帰を確認。390pxで横scrollした操作列へ到達した状態でも、固定名前セルと行背景が同色・不透明で、子操作のfocus枠を確認できた。reduced motionでも行focusを表示できた。
- Chrome: 390pxの管理ChoiceListで選択印とfocusを確認。末尾削除buttonのoutlineが切れる不具合を修正し、通常色とforced colorsで選択印・labelのfocus枠を維持することを確認した。隠したnative radio側の二重outlineはない。
- Chrome: 390pxの比較filterでnative selectへTab移動し、ページの横はみ出しとoutlineの切れがないことを確認。タブの矢印移動で「分析する」にfocusしても「次戦に備える」の選択表示を保つ。
- Chrome: 390pxの出力候補dialogで現在値、未選択候補、labelの単一focus枠を確認。ArrowDownで別の試合を選ぶとdialogが閉じ、元の「試合を変更」buttonへ可視focusが戻り、選択内容が更新された。ダウンロードやdata mutationは実行していない。
- 文書の`git diff --check`、`pnpm public:safety:check`が通過。

これらは共通部品の契約と代表画面の実装確認であり、利用者の操作時間・誤操作の減少を実証したものではない。全画面×全状態の視覚検査でもない。

### 接続復旧後のE2E確認（2026-09-14）

Playwright MCPの接続が復旧し、タブ一覧取得とアプリへのブラウザー操作が成功した。停止していた検証用runtimeは、既存の隔離E2Eスクリプトに基づく一時環境で起動し直した。普段使いのdata storeは使わず、`ui-conformance.spec.ts`のfixtureと同じ開催・2試合を作成して検証した。

同specの今回の変更に関係するflowと、共有部品の代表consumerをMCPで直接実行した。以下はブラウザー上の操作とassertionの結果であり、テストランナーで同ファイル全体を実行した結果ではない。

| 対象 | 確認した結果 |
| --- | --- |
| 試合行 | 子操作に可視focus枠があり、行自身はtabbableにならない。別行hoverとの併存、同一行での非加算、Shift+Tabでの行内移動、行を離れた後の解除が成立。pointerだけの非操作セルclickでkeyboard用の行表示を作らず、reduced motionでも実focusを表示 |
| 同条件更新 | 実通信を保留して確認。一覧は可視・非inertのまま、更新buttonだけがpendingで無効化される。busyの一覧内へ移した実focusと行表示を維持 |
| 条件変更 | 実通信を保留して確認。古い一覧は可視のままinertになり、偽のfocus帯を残さない。filterの既存native disabledによるfocus解除を変更せず、待機中に別の利用可能な操作へ移したfocusを完了時に奪わない |
| 出力候補 | 320 / 390pxでページ横はみ出しなし。native radioの選択とlabelの単一focus枠、forced colors時の選択・focus保持を確認。ArrowDownで次の正確な試合IDへURLが更新され、dialog退出後に変更buttonへ可視focusが戻る |
| 管理一覧 | 390pxで横scrollした操作列と固定名前セルへ到達でき、行と固定セルの不透明な背景が一致。確認alertdialogへfocusが移ると背景行のfocus表示が消え、Escape後は実際に戻ったbuttonに合わせて復帰 |
| 開催一覧 | 1440pxの共有行で子操作と行のfocus表示を確認。390pxのモバイル表示でも次の操作へkeyboardで移れ、ページ全体に横はみ出しがない |

これにより観点1の変更に必要なE2E gateを満たした。保存・削除・ダウンロード等の変更していない全業務flow、全E2E suite、screen readerによる読み上げ、利用者テストの効果測定までは保証範囲に含めない。今回の隔離runtimeは正常終了し、検証dataを含む一時環境の後片付けも完了した。

## 8. 確定事項

1. 行背景はユーザー回答「キーボードのフォーカス表示に連動する」に従い、子の`:focus-visible`へ連動した。
2. ユーザー回答「枠付きの副ボタンも少し明瞭にする」に従い、secondaryの4経路を対象にした。

対象範囲の確認待ちはなく、計画した実装と変更に必要な検証を完了した。

## 9. 通常のドロップダウン境界の再検討と調整（実施済み）

実装後に「ドロップダウンの枠が濃く、調和を乱す」という利用者の指摘があった。再検討の対象は、候補を開く前の通常の一行select。共通のSelectControlは現在、値・下向き矢印を持つにもかかわらず、テキスト入力と同じ3:1以上の全周境界を描く。選択欄が複数並ぶ場面で枠の反復が強くなるため、入力場所の識別を全周に担わせた前回の判断を修正する。

[W3CのBoundariesの説明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#boundaries)では、文字や十分なcontrastのiconでcontrolの存在を識別できる場合、hit areaの全周境界を必須としていない。Dropdown indicatorの例も下向き矢印を識別情報として扱う。したがって、通常selectの矢印に識別性を担わせ、全周を補助枠にする余地がある。これは全inputの境界を薄くしてよいという意味ではない。

### 比較と推奨

製品のSelectField / InputControl / Buttonとstylesheetを使う独立した比較表示をPlaywright MCPで確認した。値・寸法・矢印・面を同じにし、通常selectの枠だけを変えた。

| 案 | 標準surface上の枠contrast | 判断 |
| --- | --- | --- |
| 現行の識別用境界 | 約3.33:1 | 並んだselectの全周が強く、補助条件の枠が主張する |
| 既存の強めの構造線／副操作と同じ参照色 | 約1.57:1 | 推奨。枠を範囲の補助に戻し、値と矢印を読みやすく保つ |
| 新しい中間色（同じneutralのalpha 0.30） | 約1.89:1 | 比較したが、新しい濃さの段階を管理する理由が弱い |

推奨案の矢印は既存のsecondary text色を維持する。標準surfaceで約6.48:1、subtle / hover背景で約5.94 / 6.12:1となる。枠の1.57:1を識別基準の代わりにせず、矢印側のcontrastを確認する。薄い枠は残して操作範囲を補助し、未操作のselectをdisabledに見せるための文字・矢印の減光は行わない。

### 実装の接続

- 通常の一行selectに限り、`--color-select-border`を既存の`--ref-neutral-border-strong`へ接続する。buttonの用途tokenを流用せず、参照値を共有する。新しいpalette値やfeature別propsは追加しない。
- SelectControl内で、矢印がある一行表示・toneがdefault・invalidでない場合に選ぶ。複数選択やlistbox表示にはこの条件を広げず、矢印がない部品の識別用境界を維持する。
- tone / invalidの意味表示とfocus枠は現行を維持する。通常枠に追加hoverやpressedの変化を作らず、観点2の面の反応へ接続する。disabledの抑止と既存の減光も維持する。
- テキスト入力、textarea、未選択radioの識別用境界は今回の対象に含めない。入力とselectを混在させた場合も、同じ枠色を強制するのではなく、それぞれの識別に必要な情報とfocusの文法を揃える。
- UI規約の境界要件を「全入力部品の全周」へ拡大解釈しないよう、通常selectの矢印と補助枠の役割を明記する。色の検証も通常枠の3:1ではなく、実背景に対する矢印の識別性を対象にする。

比較表示では1440pxでの並び、390pxの横はみ出しとfocus移動、エラー枠の保持、forced colorsでのnative appearanceへの復帰・独自矢印の非表示・focus枠を確認した。これは採用前の候補比較として行った確認である。ユーザー承認後、上記の条件をSelectControlへ適用し、次の製品確認を行った。

### 調整後の検証結果

- SelectControl、色のcontrast、ScoreGridの既存test計19件が通過。矢印に使うsecondary text色は、既存の色検証でsurface / canvas / hover / subtleとのcontrastを確認している。補助枠を識別用境界の3:1 oracleへ追加するtestは作らない。
- format、lint、typecheck、production buildが通過。生成CSSに`--color-select-border`とその参照classが残ることを確認した。buildには従来のchunk size警告が残る。
- 隔離したAPI / DB / Redisとproduction buildのpreviewを使い、Playwright MCPで製品の実経路を確認した。比較filterの対象作品・シーズン・マップ、出力のシーズン、編集画面のオーナー・メンバー・プレー順へ薄い枠が接続されている。
- 比較filterはhoverで枠色や寸法が変わらず、Tabでのfocus移動、選択によるURL更新、320 / 390pxの横はみ出しなしを確認。forced colorsではnative appearanceとfocusを保ち、独自矢印を非表示にする既存の接続が成立した。
- 密な編集画面では、通常の選択欄とテキスト入力の境界、invalid / reviewの意味枠を区別できることを1440pxで確認。hover中に作品の未選択errorを解消すると通常の補助枠へ戻る。390pxでもメンバーからプレー順へfocusを移せ、ページ全体の横はみ出しはない。
- 出力画面でも通常selectの枠、単一の矢印、次の操作へのTab移動、390pxの横はみ出しなしを確認した。未変更の保存・ダウンロード処理や全E2E suiteまでを再実行した結果ではない。

新しい参照色、依存、feature別の指定、hover演出は追加せず、通常selectの境界だけを役割に合わせて調整した。検証用の一時環境は正常終了し、専用コンテナの後片付けも完了した。

## 10. 総合レビューで残った操作継続・通知の修正

- 試合一覧では、条件変更による取得中も条件欄を操作可能にした。古い一覧のinertと行操作の制限は維持し、URL・queryの既存の所有者が最後の条件を反映する。第7節の検証時に残していたnative disabledによるfilterのfocus解除は解消した。
- Toastは共通hostとrendererを同期で準備し、準備用の別描画を削除した。最初の通知から同じ文字・余白・操作要素を使い、準備完了によるfocusと表示寿命の作り直しをなくす。MotionとBase UIの既存の通知機能は維持した。
- コンポーネント検証では条件の連続変更・応答順逆転・次の条件へのfocus継続、最初の通知の要素とfocusの保持、閉じる操作、通知上限と重複排除を確認した。削除した非同期rendererの読込失敗testは、初回通知の継続を確認するtestへ置き換えた。
- Playwright MCPでは、実通信を保留した試合一覧のTab移動・古い一覧のinert・最新条件の結果・遅い旧応答の非干渉を確認。390pxでは取得失敗後も条件欄のfocusを保ち、次の条件へ変更して結果を取得できた。既存のUI conformanceへkeyboard継続の回帰stepを追加した。
- 開催作成から遷移する実経路では、遷移先moduleの取得を保留しても完了Toastを表示でき、解放後も通知の寸法・閉じるbuttonの同一性・focusを維持した。390pxでkeyboardによる閉鎖、320pxで説明文の表示・横はみ出しなし・期限終了後の除去、初回からreduced motionが有効な場合の表示を確認した。
- format、lint、typecheck、production buildと公開文書検査が通過。同期読込への変更前後で、同じgzip条件のJavaScript資産合計は約2.1kB減少し、entry chunkは約1.7kB増加した。資産の配分の比較であり、初回通信量や体感速度の実測ではない。既存の大きなchunkの警告は残る。

ブラウザー検証は変更に関係する経路をMCPで直接実行したもので、全E2E suiteの通過やscreen readerの実際の読み上げを保証するものではない。

## 11. OCRの確認箇所・比較の根拠への移動を修正する計画

2026-09-15策定。対象は連続操作レビューで確認した2件。「次の試合を記録」の導線追加は含めない。成功条件を、操作を受け付けたことから、対象が見えて作業を続けられることまで具体化する。

### 11.1 事実と未確定事項

| 対象 | 確認した事実 | 実装前に切り分ける点 |
| --- | --- | --- |
| OCR | 狭幅のサンプル確認画面で「次の要確認セルへ」を使うと、別プレーヤーの欄が開き、正しいinput / selectへfocusするが、対象が画面上方に隠れたままになる。連続する2回の移動で再現した。 | `ScoreGrid`のfocus、閉じる側のpanelの除去、focusに伴う確認項目・原画像の切替、ブラウザーのscroll補正の順序。開閉アニメーションが原因とはまだ断定しない。 |
| 比較 | 「詳しい分析」はhash更新とview更新を別々に行う。移動後はhashがなく、目的の指標が下方にあるのに先頭へ着く。戻るとreviewへ復帰するが、不要な中間履歴が残る。 | URL修正後も、現在のscroll effectは遅延読み込みbodyより外にあるため、対象の描画前に処理を終える可能性がある。初回・準備済み・遅延・履歴移動を分けて確認する。 |

OCRはサンプルと一時API、比較は既存のfixture応答を使った実画面での確認である。実機の仮想キーボード、実際のOCR精度、分析アルゴリズムの評価とは区別する。直前のUI修正がこれらの原因だったとは断定しない。

### 11.2 OCR: 対象の選択・表示・focusを一つの操作として成立させる

1. 既存の実画面で、操作直後から配置が落ち着くまでの対象rect、scroll位置、展開状態、active elementを記録する。上にあるプレーヤーの欄を閉じる移動と、逆方向の移動を比較し、位置がずれるcommitを特定する。調査用の計測は製品コードに残さない。
2. 「前へ / 次へ」の対象選択と移動要求は`ScoreGrid`に集約する。対象プレーヤー、cell ID、確認項目・原画像の対応を先に揃え、対象を含む配置に反映した時点でfocusと必要な表示位置を確保する。同じ欄への再移動でも、画面外なら対象を見せる。
3. 自動focusと明示的scrollを競合させない。focusによる意図しない自動scrollを抑えた上で、入力ラベルとcontrolがsticky headerに隠れない必要最小限の移動にする。すでに見えている対象は動かさない。最終的な実装方式は1の因果確認で選び、固定時間のtimeout、複数frameを待つだけの対処、無期限のDOM監視は使わない。
4. 移動要求は最新のものだけを完了させる。別セル・別プレーヤーの手動操作、別画面への移動、対象の消失では古い要求を破棄し、後からfocusを奪わない。幅変更で表とカードが切り替わる場合も、破棄済みのDOMを対象にしない。
5. 通常の入力・Tab・表内keyboard操作、未確定の数値入力、明示的な確認、最後の確認後に確定操作へ進む挙動を保つ。移動だけを理由に値や確認済み件数を変えない。

主な変更候補は`ScoreGrid.tsx`、`ScoreGridMobile.tsx`と、必要ならその内部の移動処理。共通`Disclosure`を変えるのは、単独でも「閉じたpanelの配置が残る」ことが原因と確認できた場合に限る。その場合は、配置・hidden状態を共通部品が所有し、セルの選択・focus先はfeatureが所有する。現行の矢印のMotionに移動処理を依存させず、既存APIにない開閉完了callbackを前提にしない。

### 11.3 比較: 根拠への移動と復帰を一つの履歴操作にする

1. `useSeriesAnalysisLocationState`と既存のURL生成処理を入口に、比較scope、選択試合、view、sectionのhash、内部`returnTo`を持つ移動先を一度で生成する。「詳しい分析」は既存の`LinkButton`へ接続し、通常クリックで履歴を1件追加する。リンクのコピー・別タブで開く操作でも同じ指標を指定できるようにする。カードから`window.location.hash`を直接書き換えない。
2. URL正規化は同じ移動先の有効なhashと復帰情報を保持する。通常のtab・比較条件変更では無関係になったsection指定を残さず、現在のreplace / pushの用途を維持する。表示位置を分析query keyへ混ぜず、scrollだけで再取得しない。
3. sectionの表示処理は、実際の遅延読み込みbodyが描画された境界へ接続する。現在のURLに対応するscope / viewの内容が準備できたことを条件に、そのbody内の対象を表示する。fallbackやinertな旧内容へ移動せず、通常tab切替のfocus保持を壊さない。初回表示、同じview内のhash変更、リンクの直接読み込みにも対応する。
4. 明示的に根拠へ進んだ場合は対象見出しを表示し、keyboardでもその地点から読み進められるfocusを確保する。対象全体への点滅・強い面色・Toastは追加せず、既存の見出し・focus表示・section余白を使う。読込待ちの間に別の操作や閲覧位置へ移った場合、古い移動要求を完了させて引き戻さない。
5. 戻る1回で元のscopeとreviewへ戻し、起点の仮説が見える状態を復元する。「ほかの仮説」内のリンクなら、その開示も復元する。原則は保存した閲覧位置を使い、幅や内容の変化で復元できない場合は起点カードを見せる。進む操作も対応する履歴の位置を優先し、同じhashだからと毎回先頭位置へ引き戻さない。
6. 復帰に必要な情報は、この比較ページの履歴entry・scopeに対応する有限の一時状態として所有する。ブラウザー標準の復元で満たせる部分は再利用し、不足部分だけを補う。アプリ全体のscroll復元方式の変更、全viewの常時mount、永続設定の追加へ広げない。対象なし・不正hash・読込失敗では移動待ちを無期限に残さず、既存の本文・エラー・再試行を使える状態にする。

主な変更候補は`navigation/useSeriesAnalysisLocationState.ts`、`SeriesAnalysisReviewView.tsx`、`SeriesAnalysisContent.tsx`、`SeriesAnalysisViewPrimitives.tsx`。戻り先の開示・位置を所有する必要がある場合だけ、pageのcompositionへ最小限の一時状態を置く。API、artifact schema、分析値は変更しない。

### 11.4 検証と完了条件

| 検証境界 | 守る結果と主な条件 |
| --- | --- |
| OCR component | 実際の`ScoreGrid`と確認stateを組み合わせ、別プレーヤーへの前後移動・同じ対象への再移動・最新要求への切替を確認する。active cell、開示、入力値、確認状態、次のkeyboard操作を判定する。toolbarのcallback呼出しだけで合格にしない。 |
| OCR browser | Playwright MCPで狭幅カードと広幅表を確認する。再現幅、最小幅、通常 / reduced motionを意味の異なる代表条件へ割り当てる。対象controlとラベルが利用可能viewport内にあり、移動後も隠れず、その場で入力を続けられることを判定する。前後移動、手動切替、最後の確認後の確定操作、幅変更を含む。JSDOMのfocus成功を配置の証拠にしない。 |
| 比較 component / router | 実カードから実router・URL ownerを通し、scope・選択試合・hash・`returnTo`、履歴の前後、通常tab切替、正規化を確認する。遅延bodyが未準備の間の扱いと古い移動要求の破棄を制御可能なPromise等で確認する。 |
| 比較 browser | Playwright MCPで実際の遅延moduleと応答を制御し、準備済み / 初回で対象見出しへ到達することを確認する。1回の戻るで起点カード・必要な開示・scopeが復元され、さらに戻ると中間履歴に留まらないこと、進む、直接リンク、不正hash、待機中の別操作を確認する。選択tabやURLの一致だけで合格にしない。 |

既存testのうち同じ失敗を検出できるものは拡張し、重複する新規suiteやsource文字列checkerは追加しない。既存のcomponent testでは、OCRのtoolbar更新や比較のview切替を確認していても、今回の画面内到達と実カード起点の履歴往復までは保証していない。

実装時のgateはWebのformat、lint、typecheck、選択したcomponent / router evidence、影響する主要flowのPlaywright MCP。production buildを使い、遅延chunkと最終CSSを含む表示を確認する。共通`Disclosure`を変更した場合のみ、その代表利用先の開閉・keyboard・配置を追加確認する。文書変更には`git diff --check`と公開文書検査を適用する。実機の仮想キーボードやscreen readerを確認していない場合は、保証範囲から明示的に分ける。

### 11.5 実施順序と判断の境界

1. OCRの配置変化と比較の遅延読込・履歴を最小の再現経路へ固定し、11.1の未確定事項を解消する。仮説と異なれば原因説明を更新してから実装へ進む。
2. OCRの修正と必要な回帰検証をまとめてcommitする。
3. 比較のURL・描画準備・復帰を一体で修正し、必要な回帰検証とまとめてcommitする。URLだけ直して到達確認を残した状態を完了にしない。
4. 共通gateと両flowのbrowser確認を完了し、本節へ実施結果・変更した責務・未検証事項を追記する。必要な表示契約は要求 / UI規約の該当箇所へ反映し、同じ規則を複数文書へ複製しない。

現時点で新しい利用者判断を必要とする仕様の曖昧さはない。未確定なのはOCRの原因と復帰処理の最小実装であり、実装前の調査で解消する。固定遅延・無条件scroll・全体の状態管理の置換に頼らず受入条件を満たせるかを判断する。

参照: [UI規約の入力・アクセシビリティ](ui-rule.md#4-入力ワークスペースアクセシビリティ)、[ナビゲーション](ui-rule.md#7-ナビゲーションと有限のタスクループ)、[review要求](requirements/series-review-playbook.md)、[品質証拠](test-rule.md#2-品質証拠の採用維持削除)。ライブラリAPIはContext7とインストール済み実装を照合した。[React Routerの移動先指定](https://github.com/remix-run/react-router/blob/main/docs/api/hooks/useNavigate.md)はsearch / hashを一つの移動先として扱える。[標準scroll復元](https://github.com/remix-run/react-router/blob/main/docs/api/components/ScrollRestoration.md)の存在だけでは、独立した遅延bodyの描画後の到達を保証したことにしない。

### 11.6 OCRの実施結果

- 実画面のcommit前後を計測し、focus時には閉じたプレーヤーのpanelが配置に残り、その除去後に対象が画面外へ移ることを確認した。原画像の切替や矢印のMotionの完了待ちではなかった。共通Disclosureは`data-closed`の時点で本文を非表示にし、内部presenceの除去を待たず配置を確定させる。
- ScoreGridは確認項目・原画像の選択を移動要求と一緒に更新し、同じ対象への再移動も扱う。要求ごとに一度だけfocusし、ラベルを含む範囲を表示する。sticky navigationの実寸を使う小さな共有表示処理を追加し、すでに見える対象の位置や他の操作へ移ったfocusを不用意に変更しない。
- 連続操作で、未変更の数値欄からblurするだけでも変更通知が発生し、確認済みになる既存経路を発見した。数値が変わる場合だけcommitし、移動や未変更のEscで確認を代行しないよう修正した。実workspaceの回帰testで未確認件数と値の保持を確認する。
- 選択したcomponent / workspace検証は4ファイル36件が通過。Playwright MCPでは390px通常表示、320pxのreduced motion、1440pxの表で前後移動と対象・ラベルの可視性を確認した。表とカードの幅切替、確認件数の保持、最後の確認後に確定操作が画面内でfocusされることも確認した。既存app smokeのfocus assertionに、閉じた欄の非表示とviewport内の位置の判定を追加した。
- format、lint、typecheck、production buildは通過。既存のchunk size警告は残る。実機の仮想キーボードとscreen readerは未検証。

### 11.7 比較の実施結果

- 「詳しい分析」を共通LinkButtonへ接続し、既存のURL生成・解析を使ってscope・選択試合・view・hash・内部returnToを一度に指定する。正規化でhashを失わないようURL ownerを修正した。目次の同一view内移動もrouterを通し、履歴のidentityと復帰先を揃えた。
- 到達処理を実指標と同じSuspense境界へ配置した。現在のscope / view / 選択試合の準備が整ったときだけ実本文の見出しを表示し、keyboardで続けられるfocusを置く。fallback、旧条件のinert本文、通常のtab切替を到達処理に巻き込まない。
- 比較ページ内で履歴entryごとの開示・起点・閲覧位置を保持する。保存位置を優先し、幅や内容の変化で起点が隠れる場合は見える位置へ補正する。保持は直近32 entryに制限し、ページを離れると破棄する。query key、API応答、分析値や永続設定へ表示位置を混ぜていない。
- 同一view内のhash履歴では、ブラウザー標準の復元が後から位置を上書きすることを実画面で確認した。比較ページが表示されている間だけscroll復元を所有し、SPAでの離脱、documentの離脱、再表示で元の方式と所有権を受け渡す。再読み込み後に比較を離れた場合も元の方式へ戻ることを確認した。
- 待機中のpointer操作、keyboard、focus移動、手動scrollや取得失敗では古い移動要求を取り消す。固定待機、常時DOM監視、追加Toast、強い強調演出、全viewの常時mountは導入していない。
- 選択したcomponent / router検証は5ファイル16件が通過。実リンクからURL ownerを通る移動、余分な中間履歴がないこと、補助仮説の開示とfocusの復元、未準備からの到達、別操作での取消、正規化後のhash保持、不正hashでも操作可能なことを確認した。既存の不正hash testはrouterのlocationを使う経路へ更新した。
- Playwright MCPでは390pxの実画面と既存の分析fixture応答を使い、通常 / reduced motion、初回の遅延chunk保留と解放、主仮説・補助仮説から根拠への到達、戻る・進むの位置と開示の復元、直接リンクの正規化、目次の往復、通常tabのfocus保持を確認した。chunk待ちの間に「指標の読み方」を開いた場合も、完了後にdialogからfocusや閲覧位置を奪わない。既存app smokeへ根拠の可視性と復帰の回帰stepを追加した。
- 両修正のブラウザー確認にはproduction buildを使用した。OCR確認欄と比較の到達先の画像も見て、ラベル・見出しがsticky navigationに隠れないことを確認した。全E2E suite、実機カメラ・仮想キーボード、実際のscreen reader発話、分析アルゴリズムを検証した結果ではない。
- 最終差分でWebのformat、lint、typecheck、production buildと公開文書検査が通過した。選択したcomponent / router / workspace検証は両修正で計9ファイル52件が通過し、既存のchunk size警告以外に残る検査失敗はない。

## 12. 入力境界と選択dialogの情報構造の再点検

### 判断と変更

- 試合番号はtext input、開催日時はdatetime-local inputであり、作品等の一行selectとは識別手段が異なる。実画面でも`control-border`と`select-border`がそれぞれの共通部品から適用され、feature側の独自色ではなかった。入力用の識別枠と矢印付きselectの補助枠を維持し、通常境界、tone、invalidの決定を`Control`の一か所へ集約した。色値、focus、hoverの反応は変更していない。
- 選択dialogではheaderの下に空のPendingStatus、可視legend、一覧上余白が重なっていた。更新表示を共通Dialogのheader slotへ移し、単一選択群は可視titleを`aria-labelledby`で参照する。通常の画面内ChoiceListではlegendを残し、型でも命名方法を一つ選ぶ。`開催（必須）`等のfield注記はその場に残し、dialogの目的は「開催を選択」に整理した。開催filter、OCR、試合入力、出力へ同じ部品を通して適用する。
- DialogとAlertDialogの見出し・本文・操作端を、本文のscroll用余白に揃えた。閉じる操作と並ぶ短いtitleはheader内で中央に配置する。閉じる操作もstatusもないheaderの高さは増やさない。選択肢のpage切替・inert化・現在値・閉じる操作の責務は維持した。

可視見出しからの命名は[WAIのグループ化](https://www.w3.org/WAI/tutorials/forms/grouping/)に沿う。Base UIのTitleはdialogの見出しとaccessible nameを所有するため、更新statusはTitleの外側へ置いた。一般的なlegendの一律非表示や、dialog全体への別の選択roleの追加は行っていない。

### 確認結果

- 既存の8 testファイル41件でnative input / select、選択・無効状態、dialogの開閉、group名、更新中のdialog名の安定、出力の選択・page切替を確認した。文言変更に伴う既存app smokeとpagination continuityを更新し、後者には更新前／更新中の一覧・ページ送りの位置保持を追加した。配置と色はclass一致のtestを増やさず実画面で判定した。
- Playwright MCPでproduction buildと架空の候補応答を使い、1440pxと320px、通常／reduced motionの代表条件を確認した。見出しと一覧の左端が揃い、見出しから最初の選択肢までの不要な空白が解消した。試合入力と出力の両方で、更新表示の出現だけでは一覧・ページ送りの位置が動かないことを確認した。keyboardでの選択結果・起点へのfocus復帰、Escape、未保存確認のcancel、説明を持つ開催作成dialogの整列と狭幅での折返しも確認した。
- 対象範囲の暫定評価は、修正前の視覚8/10（見出しの階層・関係的余白に不足）、操作9/10（重複説明による軽度の迷い）から、確認した範囲では各10/10。全画面の網羅評価や利用者調査を意味しない。全E2E suite、実機の日時picker・仮想キーボード、実際のscreen reader発話は未検証。
