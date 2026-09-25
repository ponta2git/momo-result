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
| 通知 | 待機の live region 自体または祖先に `aria-busy` が付く | 更新対象の busy と、その外側での通知を分ける |
| Tooltip | 可視説明だけを検証し、trigger との関連付けが欠ける | description の ID と既存説明を合成し、dialog の portal 境界に接続する |
| 表 | 明示 opt-in がない表は overflow 検出・keyboard 到達・案内を持たない | 表自身が overflow と caption に対応する名前・案内を所有する |
| Composition | 生 table や login anchor が shared recipe の断片を組み立てる | 汎用表・action の完結した API を消費し、feature は業務 cell と遷移だけを所有する |
| API の余分な選択肢 | 同じ描画の Disclosure variant と未使用 FactList mode が存在する | 実際の用途に対応する少数の variant へ縮約する |

複雑な widget をすべて自作する設計、すべてを Base UI へ置換する設計、React の新 API のために query / form lifecycle を置換する設計は採らない。native semantics、既存の cache / API 境界、即時の状態反映を維持する。

## 実装の責務

依存方向は `app → feature → shared semantic adapter → shared/ui → shared/lib`。`shared/ui` は domain DTO、query、route policy を所有しない。意味トークンは基盤、部品の状態 recipe は各 primitive、業務ラベル・順位・順序は adapter に置く。

- **Foundation:** reference palette と runtime token、Tailwind theme、element default、component recipe を区別する。runtime から参照する semantic token は production build でも保持する。
- **Primitive:** native element と Base UI が操作を所有し、React wrapper が名前・説明・ref・状態表現を一つにまとめる。
- **Composition:** form / dialog / table / notice は関連する slot の境界と配置を所有する。feature から leaf の class、style、motion を上書きしない。
- **Adapter:** 開催選択、順位、プレー順、固定メンバー、認証遷移は業務意味を付与する。primitive 内へ業務条件を逆流させない。

## 品質証拠

変更前の Web suite は 163 files / 1,000 tests が成功し、production build も成功した。この結果は上記の未検出条件の保証には使わない。

component evidence は実操作、名前・説明・値、focus、disabled、form submission、更新中の操作制限と回復を oracle にする。DOM class の写しや component の内部構造を主 oracle にしない。ResizeObserver の test double は明示的に geometry を通知し、jsdom を実レイアウトの証拠としない。

検証対象は Web format / lint / typecheck、選択した component evidence、production build と runtime token 保持、Playwright MCP による主要 UI flow、desktop / mobile の視覚確認。外部サービス・本番配備・実スクリーンリーダーの読み上げ順はこれらの成功から保証しない。最終結果は実施後に本節へ記録する。

## 参照した公式資料

- [React: ref](https://react.dev/reference/react/forwardRef)、[useId](https://react.dev/reference/react/useId)、[derived state](https://react.dev/learn/you-might-not-need-an-effect)
- [Tailwind CSS: theme variables](https://tailwindcss.com/docs/theme)、[source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Base UI: composition](https://base-ui.com/react/handbook/composition)、[useRender](https://base-ui.com/react/utils/use-render)、[Tooltip](https://base-ui.com/react/components/tooltip)
- [CSS cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)、[WAI-ARIA radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)

React / Tailwind / Base UI は Context7 で現行資料を取得し、具体的な API と挙動は lockfile の導入版および実行結果でも照合した。
