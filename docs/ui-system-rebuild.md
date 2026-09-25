# UI システムの再設計と検証

## 対象と受入条件

`shared/ui` の全 primitive、`styles.css`、意味を付与する shared adapter、実画面への接続と品質証拠をレビューする。既存実装を正解とせず、`ui-rule.md` が定める記録・確認・比較・出力の操作から API と責務を組み直す。業務上の状態や保存契約は変えない。

- native HTML の操作・form 契約を基本とし、複合 widget の focus、keyboard、portal は Base UI に委ねる。
- 選択値、disabled、pending、error、表示と読み上げが同じ意味を持つ。状態変更や focus を演出完了まで待たせない。
- 色・寸法・操作面は共通実装、意味・データ・業務制約は adapter / feature、外側の配置は composition が所有する。
- React の参照と DOM 属性を失わず、公開 API が許す組合せで同じ操作契約を保つ。
- source、jsdom、production CSS、実ブラウザを別の証拠として扱う。

製品の方向性は既存の「静かな対戦卓の試合台帳」を継続する。順位、固定メンバー順、プレー順の意味、低彩度の面、4px 基準の余白、表の走査密度を維持し、装飾の追加を再設計の目的にしない。

## レビューからの設計判断

| 境界 | 検出した問題 | 再設計 |
| --- | --- | --- |
| CSS cascade | layer 外の element default が明示的な utility より強い | reference / semantic / utility の用途を分離し、element default は base、部品は components に配置する |
| Action | disabled link が別 element へ切り替わり、ARIA・id・ref を失う | link の実要素と属性を維持し、移動先と activation だけを制限する |
| 選択 | segmented control が選択中の再実行を通知し、button 群で排他選択を表す | native radio による単一選択と keyboard 操作を基本契約にする |
| Field | 説明・選択状態が候補名へ混ざる。現在値と変更操作の関連付けが弱い | 安定した名前と description / checked / invalid を分離する |
| Base UI composition | Tabs の render 置換が indicator の DOM 属性・ref の所有権を不明瞭にする | Base UI の host props を保持し、Motion は内側の装飾下線の位置・幅だけを描く |
| 通知 | 待機の live region 自体または祖先に `aria-busy` が付く | 更新対象の busy と、その外側での通知を分ける |
| Tooltip | 可視説明だけを検証し、trigger との関連付けが欠ける | description の ID と既存説明を合成し、dialog の portal 境界に接続する |
| 非同期の確認 | 同一描画内の再実行、閉じて再表示した後の古い Promise が新しい操作に干渉しうる | 同期 latch と試行 identity を使い、古い完了・失敗・unmount を現在の dialog から隔離する |
| 表 | 明示 opt-in がない表は overflow 検出・keyboard 到達・案内を持たない | 表自身が overflow と caption に対応する名前・案内を所有する |
| ページ移動 | skip link の移動先 main が focus を受けず、次の Tab がページ先頭へ戻る | ready と loading の main を programmatic focus の移動先にする |
| Motion | 導入版の hook が初回の reduced motion 設定だけを保持する | app provider が設定変更を購読し、描画済み component の状態・focus を保って反映する |
| Composition | 生 table や login anchor が shared recipe の断片を組み立てる | 汎用表・action の完結した API を消費し、feature は業務 cell と遷移だけを所有する |
| 意味を付ける adapter | 開催・出力の候補名と説明が重複し、順位推移の generic span に名前を付けている | 候補の identity と metadata を分離し、順位推移を名前付きの順序リストにする |
| API の余分な選択肢 | 同じ描画の Disclosure variant と未使用 FactList mode が存在する | 実際の用途に対応する少数の variant へ縮約する |

相互レビューでは ActionLink の絶対 URL を相対 path として扱う退行と、adapter に残った description の重複も検出し、修正した。native login は pending でも開始した document navigation が成立し、browser back で操作可能に戻る。Disclosure の disabled 表示、React 19 の ref、required marker の読み上げ、Control が許す input type も公開 API と実要素に合わせた。

複雑な widget をすべて自作する設計、すべてを Base UI へ置換する設計、React の新 API のために query / form lifecycle を置換する設計は採らない。native semantics、既存の cache / API 境界、即時の状態反映を維持する。確認済みの健全な実装は残し、ファイルを書き換えること自体を受入条件にはしない。

## 実装の責務

依存方向は `app → feature → shared semantic adapter → shared/ui → shared/lib`。`shared/ui` は domain DTO、query、route policy を所有しない。意味トークンは基盤、部品の状態 recipe は各 primitive、業務ラベル・順位・順序は adapter に置く。

- **Foundation:** reference palette と runtime token、Tailwind theme、element default、component recipe を区別する。runtime から参照する semantic token は production build でも保持する。
- **Primitive:** native element と Base UI が操作を所有し、React wrapper が名前・説明・ref・状態表現を一つにまとめる。
- **Composition:** form / dialog / table / notice は関連する slot の境界と配置を所有する。feature から leaf の class、style、motion を上書きしない。
- **Adapter:** 開催選択、順位、プレー順、固定メンバー、認証遷移は業務意味を付与する。primitive 内へ業務条件を逆流させない。

## レビュー範囲と維持した契約

`shared/ui` の production 56 ファイルを、フォーム、操作・通知、基盤・データ表示の3担当で分担し、別担当による相互レビューと画面統合を行った。stylesheet、build checker、semantic adapter、primitive の利用箇所も対象とした。

| 対象 | 再設計・修正 | 点検して維持した契約 |
| --- | --- | --- |
| Foundation | CSS layer、runtime token 保持と参照検証 | `cn` の custom weight 合成、`typography` の役割別 recipe、既存 palette |
| Forms（13） | CheckboxField、ChoiceList、ChoicePickerDialogField、Control、Field、Fieldset、SegmentedControl、SelectControl、Tabs、controlPresentation | TextField、SelectField の接続、FilterBar の composition。Select の form submission / reset adapter |
| Actions（8） | ActionLink を新設し、LinkButton・IconLink を接続 | Button / IconButton の native form と pending、PendingActionContent の寸法予約、actionRecipes / actionGroup |
| Feedback（16） | Dialog の非同期試行、DialogLayer の短い viewport、Tooltip、PageLoadingFallback | DialogFloatingContainer の focus 所属、Toast / ToastHost / ToastRenderer / toastPresentation の通知寿命、ProgressBar の値正規化、Notice / EmptyState / ResourcePageState の回復、PendingStatus / Spinner / Skeleton の状態と装飾の分離 |
| Motion（4） | AppMotionProvider の設定変更、StaleShield の busy 境界 | transitions の共通時間、useSurfaceFeedback の native pointer と即時の意味状態・ref cleanup |
| Data（4） | DataTable の overflow / ref / sort、Collapsible の実状態とAPI、FactList の用途縮約 | PaginationControls の境界・無効化・ページサイズ |
| Layout（7） | PageFrame / PageContentSurface の ref 型、app の main focus target | PageHeader、ContentWithActions、SkipLink、readableText、revealPageElement の配置・読解順・native scroll |
| Navigation / status（2） | AdjacentNavigation を共通 link へ接続、StatusBadge の live region | 隣接移動の focus、業務 label と汎用 status の境界 |
| Adapter / feature | 開催・export の候補、RankTrail、AuthPanel、アカウント表・確定確認表、Disclosure の全 consumer | 固定メンバー順、プレー順、業務値、URL・request・保存・download の契約 |

## 品質証拠

変更前の Web suite は 163 files / 1,000 tests が成功し、production build も成功した。この結果は上記の未検出条件の保証には使わない。

component evidence は実操作、名前・説明・値、focus、disabled、form submission、更新中の操作制限と回復を oracle にする。DOM class の写しや component の内部構造を主 oracle にしない。ResizeObserver の test double は明示的に geometry を通知し、jsdom を実レイアウトの証拠としない。

検証結果（2026-09-25）:

| 証拠 | 結果と保証する境界 |
| --- | --- |
| Pipeline integrity | Web format、lint、typecheck、production build、public safety、diff check が成功。既存の test fixture の lint warning と大きい生成 validator chunk の build warning は残る |
| Component / unit | 全 164 files / 1,024 tests 成功。後続の限定修正は該当 suite を再実行。radio の keyboard、form/reset、ref、description、pending、古い非同期結果、toast の停止・再開・退出、実行中の motion preference を検証 |
| Production artifact | canonical build で動的参照の semantic token と参照先の定義を確認。checker は正常な artifact に加え、意味 token 欠落・参照先欠落・循環の3 negative fixture を複製した artifact で検出 |
| 主要 UI flow | 隔離したローカル API と production preview で標準 Playwright suite の全15経路を成功確認。失敗の修正後は対象経路を再実行。開催作成、OCR取り込み・確認・保存、管理、比較、filter、export、pagination、Select、native login、skip link、表の keyboard scroll を含む |
| Playwright MCP / visual | production preview の 1440px desktop、375px mobile、640×320px の短い dialog を実操作・画像で確認。表の案内と実 scroll、focus 移動、dialog 内の Select、下線と選択 tab の実位置・幅、元画像の native radio 矢印操作、forced colors の選択標識、実行中の reduced motion を確認 |
| Paint | production CSS をブラウザの sRGB canvas へ描画し、順位1の mark / surface が 3:1、前景文字 / rank 面と淡色 mix 上の主要文字が 4.5:1 を上回ることを確認。source の色空間計算を実描画の代用にしない |

E2E の初回はブラウザ実行ファイルが不足し、起動前に終了した。必要な Chromium を一時領域へ導入した後に検証した。実行後に判明した region 名の部分一致、busy wrapper の位置を固定した期待値、mock HTML の文字コード、media 変更直後の未確定 paint の読み取りを修正し、実際の操作・表示の oracle へ改めた。

外部 OAuth provider、実スクリーンリーダーの読み上げ、Safari / Firefox と実モバイル OS の描画は未検証。分析 artifact と元画像の細部は API 境界の fixture を使用し、worker の分析生成・実 OCR 精度はこの検証範囲に含めない。

## 参照した公式資料

- [React: ref](https://react.dev/reference/react/forwardRef)、[useId](https://react.dev/reference/react/useId)、[derived state](https://react.dev/learn/you-might-not-need-an-effect)
- [Tailwind CSS: theme variables](https://tailwindcss.com/docs/theme)、[source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Base UI: composition](https://base-ui.com/react/handbook/composition)、[useRender](https://base-ui.com/react/utils/use-render)、[Tooltip](https://base-ui.com/react/components/tooltip)
- [CSS cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)、[WAI-ARIA radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)
- [list-style と list semantics](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility)

React / Tailwind / Base UI は Context7 で現行資料を取得し、具体的な API と挙動は lockfile の導入版および実行結果でも照合した。
