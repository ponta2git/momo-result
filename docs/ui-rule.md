# Web UI / UX 規約

目的: momo-result の全ページで、同じ意味・状態・操作を同じ見た目と挙動で表し、画面追加や改修で局所的な例外を増やさないための正本とする。

## AI作業導線

この文書はUIの意味表現と操作上の不変条件を決める。画面の目的・情報設計・文言の意図をここから推測しない。

| 項目 | 到達先 / 判断 |
| --- | --- |
| 第一読 | 画面の状態表示、操作、余白、token、motion、loading / empty / error、画面遷移を変えるときに読む。 |
| この文書だけで決めること | 同じ意味を同じ部品・token・操作で表すための実装不変条件。 |
| 常に併読 | `docs/test-rule.md` と `docs/dev-rule.md`。UI変更は状態と操作を直接検証する。 |
| 条件付き併読 | UI方向とcomponent anatomyは `docs/requirements/design-system.md`、UI文字列は `docs/requirements/writing-guidelines.md`、画面固有の目的は対象要求、Web層は `docs/architecture.md`。 |
| 実行正本 | `apps/web/src/styles.css` とtheme定義、`shared/ui`、対象component、`apps/web/scripts/check-ui-consistency.mjs`。 |
| 検証先 | 本書の検証章、`docs/test-rule.md` のWeb規則、必要なTesting Library / Playwright gate。 |

## 1. 基本原則

- 画面は、落ち着いた記録台帳として情報の比較と入力を優先する。装飾だけの面、影、色、動きを増やさない。
- 同じ意味には同じ共有 component と semantic token を使う。feature 固有の見た目で共通概念を再実装しない。
- 色だけ、位置だけ、動きだけに意味を持たせない。ラベル、形、境界、アクセシブル名を併用する。
- 説明文を足す前に、見出し、区画、行列の交点名、軸名、ラベル、値の並びで意味を伝える。計算した事実だけの文章や、画面・実装都合の弁明は初期表示へ置かず、利用者の判断または次の行動を助ける情報だけを残す。
- 可視見出しを持つ分析sectionは見出しと`aria-labelledby`で結び、比較行列は視覚だけのgridではなく行見出し・列見出しを持つnative tableで実装する。行列内の恒常ラベルは11px未満にしない。
- 複雑指標の初期表示は比較点、対象範囲、品質、結果に絞る。補助開示は「意味」「判断」「次に見る根拠」「使わない場面」「必要な計算条件」の順を基本とし、注意だけで終わらせない。
- PC とスマートフォンで情報や操作の意味を変えない。配置を変える場合も、状態と導線の契約は共通にする。

## 2. 色、順位、状態

- 色は `apps/web/src/styles.css` の semantic token を使う。Tailwind の palette 色を feature から直接指定しない。
- 最終順位は `RankBadge` / `RankTrail` と `--color-rank-*` を使う。プレーヤー色、任意の警告色、グラフ固有色で順位を代用しない。
- プレーヤー識別は `--color-player-*`、処理状態は `StatusPill`、ページ内通知は `Notice`、短時間の完了通知は toast を使う。
- 成功、警告、要確認、危険は semantic tone と文言を併用する。業務上の順位と処理状態の色を混同しない。
- 日時、金額、試合番号、状態名は共有 formatter / ViewModel の正規表記を使い、画面ごとの略記を増やさない。

## 3. 面、余白、階層

構造余白は 4px 基準の定義済み scale を使う。2px は badge 内や文字の光学調整に限り、page、section、card の構造間隔には使わない。

| 役割 | 基準 |
| --- | --- |
| ページ内の主要 section 間 | `PageFrame` の `gap-4` |
| card / empty state の内側 | `p-4` |
| compact notice / status surface | `p-3` |
| section 内の通常要素間 | `gap-3` または `gap-4` |
| badge / inline metadata | `gap-1` または `gap-2` |

- scroll affordance、sticky cell の重なり、光学調整を除き、片側だけの任意余白や任意 px 値を足さない。
- 通常の card や選択状態には影を使わず、border と surface 色で階層を示す。
- 浮遊通知と tooltip は `--shadow-raised`、dialog は `--shadow-dialog` を使う。
- z-index は `--z-base`、`--z-sticky`、`--z-sticky-raised`、`--z-dropdown`、`--z-toast`、`--z-dialog`、`--z-tooltip` の順序に従う。数値や `calc()` を feature に書かない。

## 4. 操作と開示

- button と button 相当 link は `Button`、`IconButton`、`LinkButton` を優先する。生の操作要素が必要な場合も、モバイルで 44px 以上の操作領域を持たせる。
- form は `Field` と共有 control を使い、可視 label、説明、必須、入力エラー、disabled / pending を同じ field 境界で関連付ける。
- 開閉 UI は `Disclosure` を使う。tab、dialog、単なる表示切替をアコーディオン風に見せない。
- 開示時は trigger の位置と幅を保ち、panel を trigger の直後へ展開する。高さを補間して周囲を揺らさず、必要なら opacity / transform だけを使う。
- 保存、削除、再読み込みの失敗は、操作した dialog、form、section の近くへ残す。全画面 error や toast だけへ逃がさない。

## 5. Motion

- motion token と Motion variant は 200ms 以内にする。常時ループは進行状態の spinner / skeleton に限る。
- CSS transition は変化する property だけを指定し、`transition-all` を使わない。
- CSS animation / transition は `prefers-reduced-motion` で無効化する。Motion component はアプリ共通の reduced-motion 設定に従う。
- route、panel、選択 indicator の動きは情報の連続性を示す目的に限り、装飾のために一斉描画しない。

## 6. Loading、空、失敗、再取得

- 初回 loading は最終 layout に近い structural skeleton を使い、主要な幅、高さ、列構造を保つ。
- 再取得時は、古い内容を消して全面 skeleton に戻さない。内容を保持して `aria-busy` と更新表示を添え、更新中の誤操作だけを防ぐ。
- error、not found、empty は別状態として扱う。再試行可能な error には同じ場所で retry を出す。
- empty state は、次に行える安全な操作がある場合だけ action を出す。権限や前提条件で実行不能な導線は表示しない。
- route error の再試行では Query error state と error boundary の両方を reset する。

## 7. 画面遷移

- 一覧、詳細、編集、出力、OCR、設定管理をまたぐ導線は、必要に応じて内部 `returnTo` を保持する。
- `returnTo` はアプリ内 path だけを受け入れ、外部 URL、期限切れ、復元不能を区別する。復元できない場合は安全な既定導線と説明を出す。
- 子画面から戻るときは、可能な範囲で親画面の filter、sort、page、選択文脈を維持する。

## 8. 検証

- `pnpm --filter web lint` は `scripts/check-ui-consistency.mjs` を実行する。
- checker は raw shadow / palette / duration / z-index、未定義の意味 token、200ms 超過、reduced-motion 漏れ、構造用の半端な余白、生の小さい操作領域を失敗させる。
- UI 表示や操作経路を変えた場合は Testing Library で状態と操作契約を固定し、ログイン後の主要導線は Playwright で PC / mobile の両方を確認する。
- screenshot は補助証拠とし、loading、empty、error、success、URL、download、保存結果などの外部契約を主 oracle にする。
