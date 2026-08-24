# Web UI / UX 規約

目的: UI の意味表現、操作、状態、画面遷移を一貫させる。component / token の現在値は `apps/web/src/styles.css`、`shared/ui`、UI checker を正本とする。

## 1. Meaning / Hierarchy

- 画面は記録と比較を優先し、装飾だけの面、影、色、動きは効果的に用い、むやみやたらに増やさない。
- 同じ意味には同じ shared component と semantic token を使う。色、位置、動きだけに意味を持たせず、label、形、境界、accessible name を併用する。
- 説明文を足す前に、見出し、区画、table の row / column header、軸、label、値の並びで意味を伝え、それで十分な場合は足さない。
- 複雑な分析は比較点、対象範囲、結果を先に示し、補助説明は判断と次の行動に必要な内容だけを段階開示する。品質は、低い場合にのみ警告する。
- PC / mobile で配置が変わっても、情報、状態、操作、戻り先の意味は変えない。

## 2. Color / Layout

- feature から palette 色を直接指定せず semantic token を使う。順位、player、処理状態、warning を同じ色体系で代用しない。
- 日時、金額、試合番号、状態名は共通 formatter / ViewModel の表記を使う。
- 構造余白、shadow、z-index は定義済み scale / token だけを使う。任意値を追加する前に既存 token で表現できない意味を確認する。
- 通常の階層は border と surface で表し、shadow は浮遊 UI に限定する。
- 比較行列は native table と row / column header を使い、視覚だけの grid にしない。

## 3. Interaction / Disclosure

- button、link、form control、status、notice は shared UI を優先し、mobile でも十分な操作領域を確保する。
- form は可視 label、説明、必須、error、disabled / pending を同じ field 境界で関連付ける。
- disclosure、tab、dialog、navigation を見た目だけで取り替えない。開示 panel は trigger の直後へ展開し、周囲を不必要に揺らさない。
- 保存・削除・再取得の失敗は操作した form / dialog / section の近くに残し、toast だけへ逃がさない。
- keyboard、focus、label、contrast は WCAG AA 相当を目標にする。

## 4. Motion

- motion は状態の因果と連続性を示す場合を中心に使い、定義済み duration 内に収める。変化する property だけを transition する。
- 常時 loop は進行中表示に限定する。
- CSS / component motion は reduced-motion 設定で無効化できること。

## 5. Loading / Empty / Error

- 初回 loading は最終 layout に近い skeleton で主要な寸法と構造を保つ。
- refetch は既存内容を保って更新中を示し、誤操作だけを防ぐ。全面 skeleton へ戻さない。
- error、not found、empty、stale data を別状態にし、retry は失敗箇所へ置く。
- empty action は現在実行可能な安全な操作だけを出す。
- route retry は query と error boundary の両状態を reset する。

## 6. Navigation

- 一覧、詳細、編集、出力、OCR、管理をまたぐ場合は必要な filter、sort、page、selection、内部 `returnTo` を保持する。
- `returnTo` は app 内 path だけを受け入れる。無効・期限切れ・復元不能では安全な既定導線と説明を出す。

## 7. Verification

- UI checker は token、shared UI、操作領域、motion、reduced-motion など決定可能な規則を検査する。
- 表示・操作を変えたら Testing Library で状態と interaction を固定し、主要 flow は Playwright で PC / mobile を確認する。
- screenshot は補助とし、state、URL、request、download、保存結果を主 oracle にする。
