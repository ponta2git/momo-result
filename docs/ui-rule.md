# Web UI / UX 規約

目的: momo-result の全画面で、同じ意味・状態・操作を同じ見た目と挙動で表し、記録、確認、比較、出力を迷わず完了できるようにする。

本書は Web の横断的な意味表現、視覚階層、操作、安全性、状態表示の正本である。業務用語・状態遷移は `docs/domain-rule.md`、画面固有の目的・順序・指標は対象要求、実装境界は `docs/architecture.md`、検証手段は `docs/test-rule.md`、実行 command は `docs/dev-rule.md` を正本とする。component、token、formatter の現在値は実装と checker を正本とし、本書へ複製しない。

## 1. Product Direction / Meaning

- 製品は generic dashboard ではなく、登録済み試合を探し、確定状態を理解し、次の必要操作へ進むための落ち着いた試合台帳として設計する。
- 開催回、試合番号、OCR、下書き、確定、順位、結果、出力という業務語彙を使い、抽象的な dashboard 語彙へ置き換えない。
- ドメインの用語と状態遷移は `docs/domain-rule.md` を参照し、UIでは対象、親スコープ、現在状態、実行可能な次操作を利用者が判断できるようにする。
- 同じ意味には同じ shared component、semantic token、formatter を使う。feature 固有の見た目で共通概念を再実装しない。
- 利用者または保存済みデータが提供していない指標、件数、原因、信頼度、推薦を UI 都合で補完しない。不明、未分類、計算不能、対象なしは、その状態を明示する。
- 信頼性は例外として扱い、通常または十分な状態を繰り返し強調しない。`参考値`、`信頼度低め`、`対象なし` は意味を混同せず、metadata 欠落から健全性を推測しない。
- PC と mobile で配置が変わっても、情報、状態、操作、現在地、戻り先の意味を変えない。
- 構造、label、境界、整列、accessible name で意味を伝える。説明文を足す前に構造で解決し、主要操作や未知の操作を説明不要として隠さない。

## 2. Orientation / Visual Hierarchy / Disclosure / Data

- page title、global navigation の現在地、必要な親スコープ、主要な検索・絞り込みを、初見の画面でも判断できる位置へ置く。詳細画面は安全な戻り先を持つ。
- feature から palette 色や one-off color を直接指定せず semantic token を使う。action color は選択、focus、操作可能性の強調に限定し、色だけで状態、系列、順位、warning、selection を伝えない。
- 一次情報、補助情報、label、placeholder、disabled を既存の text token と weight で階層化する。値より目立つ説明文や、装飾だけの heading を増やさない。
- 余白は定義済み token を使い、密接な要素よりグループ間を大きくする。padding は内容上の理由がない限り対称にし、任意の値や z-index を追加しない。
- 通常の階層は border と静かな surface 差で表し、shadow は dialog、tooltip、toast など浮遊 UI に限定する。gradient、glow、大きな surface contrast を密な業務画面の装飾に使わない。
- 日時、金額、試合番号、状態名は共通 formatter / ViewModel を使い、整列する数値には tabular numerals を使う。
- native table は row / column header と identity を保つ。graph は数値表現を併記し、比較軸、単位、スケールを揃え、正確な比較を装飾で代替しない。
- disclosure、tab、dialog、navigation を見た目だけで取り替えない。panel は trigger の直後へ展開し、周囲の位置・幅・focus を不必要に変えない。
- 可視 heading を省略する場合も `section`、`aria-label` / `aria-labelledby`、field label、accessible control name で構造を保つ。
- filter の全解除は scope を示す1操作に集約し、部分解除と似た名前で並べない。active 条件は短く要約しても full label を DOM と accessible name に残し、開閉状態は局所的な chevron などで示す。
- 主要操作は常時発見可能にし、二次操作だけを段階的に開示する。icon-only 操作や hover-only 情報を主要導線にしない。

## 3. Component / Interaction / Accessibility

- button、link、form control、status、notice、dialog、disclosure は shared UI とアクセシブルな primitive を優先し、feature で keyboard / focus 挙動を手作りしない。
- interactive component は該当する default、hover、focus-visible、active、disabled、pending / loading、error、success を定義する。data surface は loading、empty、error、stale、not found を混同しない。
- 操作は影響する対象の近くへ置き、label は対象と結果を示す。選択、scope、並び順、表示範囲の変更は、影響領域へ持続的に反映する。
- mobile の主要操作と icon-only action は 44px 以上の hit target を持つ。icon-only action は文脈を含む `aria-label`、decorative icon は `aria-hidden` を持つ。
- hover で現れる操作や情報は keyboard focus と touch でも到達できる。tooltip は補助説明であり、主要な意味やエラーをそこだけに置かない。
- form は可視 label、説明、必須、validation error、disabled / pending を同じ field 境界で関連付け、paste を妨げない。
- status navigation は少数の直接 filter とし、未完了の下位状態を従属させる。選択中 control の再実行で duplicate load や flicker を起こさない。
- 操作前に対象、制約、影響を示し、失敗時は「何が起きたか・理由・修正方法・代替手段」を操作箇所の近くに表示する。入力、選択、scroll 位置を失敗で消さない。
- 保存、削除、再取得、download の失敗は local error とし、toast だけへ逃がさない。同じ結果を toast と inline notice に重複表示しない。
- 不可逆または高コストな操作は対象と結果を `AlertDialog` で明示する。安全に可逆な操作は即時反映と Undo を優先し、pending 中の重複実行を許さない。
- 複数ステップの flow は Back、キャンセル、完了または安全な中断点を持つ。ダイアログを閉じた後は起点へ focus を返し、ナビゲーションを阻止する場合は理由と進行状況を示す。
- fixed / sticky UI は safe-area inset を尊重し、focus target や主要操作を viewport 外へ隠さない。狭い幅では label を短くするか reflow し、hit target と accessible name を保つ。
- keyboard、focus、label、contrast、status announcement は WCAG AA 相当を最低基準とする。

## 4. Loading / Empty / Error / Feedback / Motion

- 初回 loading は最終 layout に近い structural skeleton を使い、refetch は既存内容を保って更新中を示す。全面 skeleton へ戻さない。
- error、not found、empty、stale data を別状態にする。retry は失敗箇所へ置き、route retry は query と error boundary を同時に reset する。
- empty state は現在実行可能で安全な primary action を最大1件だけ示す。権限または前提条件で実行不能な導線を出さない。
- ancillary resource の失敗で取得済み主表示を置き換えない。完了結果が画面上で明らかな場合は celebratory toast を追加せず、局所的な feedback を優先する。
- motion は状態の因果または連続性を伝える場合だけ使う。既存 token、短い feedback、opacity / transform を使い、layout shift、stagger、常時 loop、engagement 目的の演出を避ける。
- 非必須 motion は `prefers-reduced-motion` で無効化し、route content の表示を animation 完了まで block しない。

## 5. Navigation / Finite Task Loop

- 一覧、詳細、編集、出力、OCR、管理をまたぐ場合は必要な filter、sort、page、selection、内部 `returnTo` を保持する。`returnTo` は app 内 path だけを受け入れ、復元不能時は安全な既定導線と理由を示す。
- task flow は trigger、最小の action、確認可能な result、明確な終了の有限ループにする。完了後の streak、urgency、variable reward、engagement-only CTA は追加しない。
- 保存・確認した試合や修正済み OCR data は、将来の検索、比較、出力を改善する investment として扱い、export を妨げる switching cost を作らない。
- 通知または再訪誘導には、利用者が明示した業務上の価値、停止地点、設定、opt-outを要求正本で定義する。FOMO や不安を目的に使わない。
- 頻繁な低リスク操作には shortcut、最近の条件、保存済み filter などの高速化を許可するが、通常経路と発見可能なラベルを隠さない。

## 6. Shared Result Ledger

- 試合詳細と選択試合の比較で同じ4人の result ledger を共有し、順位、player name、total assets を主情報、補助指標を従属情報とする。画面固有の表示順・指標定義は対象要求を正本とする。
- before / after の差は「改善」「後退」「維持」「初戦」と値を併記し、signed decimal だけに意味を持たせない。
- primary result は同一 scope の比較取得にブロックされず、failure または対象試合なしでも保存済み result ledger を残す。
- match identity は text として残し、navigation と export は明示した action として表す。compact action の target、label、tooltip は共通 component に従う。

## 7. Verification

- UI checker は raw palette、undefined token、arbitrary spacing、small hit target、motion、reduced-motion など決定可能な規則を検査する。
- component test は state matrix、keyboard、focus、accessible name、local error、pending 中の重複操作を実操作で固定する。
- 主要 flow は Playwright で PC / mobile の主要状態を確認し、URL、request、保存、download、主要結果を主 oracle とする。意図しない横 scroll、safe area、focus復帰、dialog / disclosure の位置変化も確認する。
- screenshot は補助とし、視覚レビューでは hierarchy、読み幅、関係的余白、product specificity、restraint、structural fit を確認する。初見の利用者が目的・現在地・主要操作を説明できるかを Trunk Test / cognitive walkthrough で確認する。
- UI変更の完了時は、対象要求、実行正本、checker、component test、必要な Playwright が同じ規則を検証していることを確認する。
