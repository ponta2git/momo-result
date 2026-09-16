# 選択肢表示の共通化 — 調査と導入案

状態: 提案・未実装。2026-09-15時点の規約、実装、公式資料を確認した。表示契約の正本は [UI規約](ui-rule.md)、責務の正本は [architecture](architecture.md) であり、本書ではまだ変更していない。

後続の [実装計画](ui-select-plan.md) に対象・変更順序・受入条件を整理した。入力表の選択欄も他の選択欄と同じキー操作に揃える方針は、利用者の回答で確定済み。実装時の判断は同計画を参照する。

## 1. 判断

**既存の Base UI Select を操作基盤として、自前の shared UI で候補の外観・配置・状態表示を統一する案を推す。ただし、代表的な難所を試作してから採用を確定する。**

利点は、開く前後で文字・余白・選択表示を揃え、現在値と操作中の候補をアプリ内で一貫して追えること。ネイティブの選択操作はすでに利用可能であり、置換だけで入力が速くなる、アクセシビリティが向上するとは判断できない。モバイルで慣れたOSの選択画面を失う負担も評価する。

| 方式 | 得られるもの | 負担・限界 | 評価 |
| --- | --- | --- | --- |
| 現状の native select | OSに馴染んだ操作、少ない独自実装 | 開いた候補の外観を統一しにくい | 保守負担を優先するなら妥当な継続案 |
| native select のCSSカスタマイズ | selectの構造を保って候補を装飾できる | 対応しないブラウザーではnative表示に戻る | 対応環境が揃えば再評価する候補 |
| Base UI Select + shared UI | 候補表示を統一し、操作基盤を既存の依存先に集約 | フォーム、入力表、重なり順の移行と継続検証が必要 | 今回の目的に最も適合 |
| キーボード・フォーカスを含め完全自作 | 任意の動作を作れる | ブラウザー・支援技術・touchの差異まで保守する | 現在の用途では負担に見合わない |

`appearance: base-select` / `::picker(select)` は実在する選択肢であり、nativeでは装飾不能と断定しない。ただしMDNは `::picker()` を非Baselineとし、WebKitの2026年6月の発表はSafari 27への導入を案内している。現行の対象環境全体へ同じ表示を提供できる前提には置けない。[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::picker)、[WebKit](https://webkit.org/blog/18117/the-golden-rule-of-customizable-select/)

## 2. 現在の実装と影響範囲

production sourceのJSX利用箇所を集計した。画面数・実際の表示個数ではない。

| 入口 | 利用箇所 | 現状 |
| --- | --- | --- |
| `SelectField` | 25 | 可視ラベル、説明、エラーとnative selectを接続 |
| featureからの `SelectControl` 直接利用 | 4 | 試合入力表のメンバー・プレー順、desktop/mobile各2箇所 |
| 生の `<select>` | 1 | sharedの `Control.tsx` に集約済み |

- 対象は一覧の絞り込み・表示件数、比較条件、OCR設定・カメラ、試合入力、管理フォーム、出力など。複数選択や `size > 1` の利用は確認されず、候補は文字ラベルと文字列値で表現されている。
- `SelectField` のうち5箇所は `name` を持つ非制御フォームで、FormDataへ接続する。別名作成のプレーヤー欄には `value` / `defaultValue` がなく、nativeの先頭候補選択に依存する箇所がある。
- 残る20箇所と入力表4箇所は制御値を使う。値の変更には、依存する条件のリセット、URL更新、再取得、プレー順の入替などが接続される。
- 現在の `SelectControlProps` はHTMLSelectElementの属性・ref・イベントと任意のoption childrenを公開する。内部DOMだけをbuttonへ置換して互換とみなすことはできない。
- 実データでの最大候補件数や長さは未計測。候補数を固定して判断せず、作品・シーズン・メンバー・機器名の代表値を試作で確認する。

参照: [Control](../apps/web/src/shared/ui/forms/Control.tsx)、[SelectField](../apps/web/src/shared/ui/forms/SelectField.tsx)、[MemberAliasPanel](../apps/web/src/features/masters/MemberAliasPanel.tsx)、[ScoreGrid](../apps/web/src/features/matches/workspace/scoreGrid/ScoreGrid.tsx)。

今回の候補は `<select>` の単一選択に限定する。開催・試合のような日時や件数を読んで選ぶ `ChoicePickerDialogField`、radio、tabs、segmented control、日時inputのブラウザpickerはそれぞれの役割を維持する。検索・複数選択・仮想化を先回りしてSelectへ足さず、検索が必要な候補は別途Comboboxとして検討する。

## 3. 規約への組み込み

現行UI規約 §4には次の明文がある。

> checkbox、radio、select、text input は native semantics を保ち、見た目のために keyboard 操作を再実装しない。

Base UIによるselectはこのselect-native条件をそのまま満たさない。採用する際は、**単一選択を共通のBase UI Selectへ集約する条件を明記して改訂する**。見た目のための任意な独自ARIA部品を一般許可する変更にはしない。

| 所有先 | 採用時に明確にすること |
| --- | --- |
| UI規約 §3・§4 | 適用する単一選択、可視ラベル、現在値と操作候補の違い、フォーム・keyboard・touch契約 |
| architectureのowner表 | dialog / disclosureに加え、selectのopen・focus・keyboardをBase UIとshared primitiveが所有 |
| UI規約の反応の文法 | hoverの既定補間を再利用し、選択・focus・errorは即時に表示 |
| shared実装 | 外観、popup、portal、寸法、状態対応を一箇所に集約 |
| feature | 候補・ラベル・値の業務的な意味、変換、URL・query・副作用を引き続き所有 |

Base UIは既に依存に含まれ、インストール済みの1.8.0でSelectの型と実装を確認した。新しい操作ライブラリは不要だが、新しいSelectコードの配信量がゼロになる意味ではない。

## 4. 共通部品の境界

接続は `feature → SelectField → SelectControl → Base UI Select` を基本とする。入力表だけは可視ラベル配置が異なるため、現在どおり `SelectControl` を直接使う。

- `SelectField` はlabel / description / errorの関連付けを所有する。
- `SelectControl` は選択値、候補、開閉、可視triggerへのref、popupと状態表示を所有する。通常のButton variantで外観を代用せず、現在の選択用境界・tone・invalid・密度の契約へ接続する。
- 値は現在必要な文字列の単一選択とし、`options` と `onValueChange(value)` を使う。native `onChange(event.target.value)` を偽装する互換イベントや、Base UIの全propsをそのまま公開するAPIは作らない。
- 非制御フォーム向けの `name` / `defaultValue`、必要なフォーム属性を明示して残す。hiddenのフォーム連携要素と、利用者が操作するtriggerの責務を区別する。
- ref、`data-validation-path`、label、説明、errorは可視triggerに接続する。現在のエラー誘導は属性で要素を探してfocusするため、wrapperやhidden inputへ付けると誘導を壊す。
- 空文字は「すべて」「未紐付け」「未選択」など意味が異なる。共通部品で一律にdisabled placeholderへ変換しない。現在候補にない値や候補更新時のリセットも、feature側の契約を保つ。
- 非制御フォームの先頭選択は移行時に明示する。全画面を新たな「選択してください」で一手増やさない。labelの「必須」という文字から新しいnative validationを勝手に導入しない。

Base UIはフォーム連携と制御・非制御値を提供するが、既存フォームのreset・初期値・送信結果が同じになることはアプリ側で検証する。[Base UI Select](https://base-ui.com/react/components/select)

## 5. 見た目と反応の文法

目的は、控えめな閉じた欄から、同じ文字・余白・状態表現の候補一覧へ自然につながること。popupは別のカードやダイアログのように主張させない。

| 状態・構造 | 接続案 |
| --- | --- |
| 閉じた欄 | 現在の薄い選択用枠と矢印を維持。値や開閉で幅・高さを変えない |
| 開いた候補 | 既存surface、浮遊面のshadow、角丸・余白scaleを使用。重複する見出し・説明を足さない |
| 現在の選択 | checkと選択状態の面で持続表示。色だけに依存しない |
| 操作中の候補 | まだ確定していない候補として識別し、選択済みの印と混同しない |
| pointer hover | 既存 `useSurfaceFeedback` と既定100msへ接続 |
| keyboard focus / 選択確定 / disabled / error | 意味の切替は即時。古い選択を残す補間や色だけの識別を避ける |
| touch / 長い候補 | touchのhit target、可読性、viewport内の一覧スクロールを共通部品で確保 |

Base UIのhighlightはpointerとkeyboardの双方から変わるため、`data-highlighted` を単純にfocus-visibleやhoverと同一視しない。現在選択・操作候補・hoverの対応を試作で確認し、mouseからkeyboardへ切り替えたときに二つの操作先が競合しない表現にする。

初期案では候補を欄の下へ配置し、収まらなければ上へ反転させる。選択項目をtriggerへ重ねる配置は使わず、操作元を見失わせない方針とする。候補幅は少なくとも欄に揃え、長文はviewportに収めて読めるようにする。

開閉アニメーションは採用の必須条件にしない。まず即時開閉で操作を成立させ、必要性が確認された補間だけMotionへ接続する。CSS有限transitionの新例外や、animation完了を待つfocus・値更新は設けない。通常の選択にToastは足さない。

## 6. 先に解消する三つの統合リスク

### 6.1 入力表のkeyboardとOCR誘導

現在のScoreGridは上下キー・Enterなどをセル移動に使い、左右移動では `HTMLSelectElement` 判定も使う。カスタムSelectの候補移動・開閉とそのまま併用すると、popupを操作しながら裏でセルが移動する可能性がある。portal内のイベントもReactの親へ届くことを考慮する。

推奨は、selectにfocusしている間のEnter / Space / 上下キーを通常の選択操作に割り当て、popup内の操作を表の移動へ渡さないこと。数値入力のEnter移動は維持できるが、**select上での従来のセル移動まで完全維持する案ではない**。閉じた状態の左右キーによる表移動は、選択操作と衝突しないことを確認して残す。採用計画では入力速度への影響と操作ガイドの変更まで確定する。

候補のhighlightだけでプレー順を入れ替えたり、値変更に接続した処理を開始したりしない。閉じた状態の文字キー選択など、ライブラリが値確定として扱う操作は別に確認する。OCRの誘導先、画像との対応、review状態の変化条件は維持し、選択の取消で値変更を発生させない。

### 6.2 ダイアログ内の重なり・focus・scroll

現在のtokenはdropdownが40、dialogが80。popupをbodyへportalしてdropdownの値を付けるだけでは、管理フォームなどでダイアログの後ろへ隠れる。ダイアログ内のスクロール領域へ直接置くと、今度はoverflowで切れる可能性がある。

owning dialogのfocus管理と重なり順に参加し、スクロールする本文や切り抜かれるsurfaceの外へ候補を描画する接続をsharedで設計する。実際のportal hostとfocus連携は試作で確定し、featureにz-index指定やportal先の選択を渡さない。全dropdownを一律に全dialogより上へ上げる対策にはしない。

Base UIのmodal設定・配置設定は既定値任せにせず、外側クリック、Escape、page scroll、親dialogの閉じ方を通常画面と入れ子の両方で確認する。PCとmobileの外観統一を、端末に不向きな同一配置の強制と取り違えない。

### 6.3 フォームと選択確定

初期値、再表示、FormData、reset、disabled、空文字と未選択、エラー後のfocusを実際のフォームで確認する。制御値の変更は確定した選択で一度だけ通知し、同じ候補の再選択で再取得を増やさない。

Tab・Escape・外側クリック・文字キーの確定／取消は、Base UIの現在の挙動を試作で観測して契約を決める。APGの特定サンプルのキー表を無条件に上書き実装しない。APGもブラウザー・支援技術、特にmobile/touchでの実確認を求めている。[WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)

## 7. 導入順序と採否の確認

1. **難所の試作**: 入力表、FormDataを使うdialog、URLや依存候補を変えるfilterの3文脈に同じ共通Selectを接続する。keyboard、フォーム、portalの成立を先に確認する。操作と外観の契約はこの結果で具体化する。
2. **採否と正本の更新**: nativeとの差をdesktop・mobileで比較し、規約の限定改訂と共通APIを確定する。入力表は利用者が選んだキー割当で、選択と欄移動が迷わず行えることを確認する。
3. **横展開**: 対象25+4利用箇所を共通部品へ移行する。`event.target.value`、option children、ref、初期値を明示的に更新し、恒久的な画面別native/customの混在を作らない。
4. **検証**: sharedの操作契約と、入力・OCR・比較・出力の影響する主要flowを検証する。既存の `selectOptions` / `selectOption` は開く・候補を選ぶ操作へ変更し、送信値・URL・入力結果など利用者の結果をassertし続ける。

採用条件は、見た目が揃うことに加えて次を満たすこととする。

- 現在値と移動中の候補を見分け、keyboardだけで選択・取消・次の操作へ移れる。
- エラーやOCR誘導で、対象プレーヤーの操作可能な欄へfocusが届く。
- 候補を開いても欄や周囲の配置が跳ねず、dialog内・viewport端でも候補とfocus表示が切れない。
- 送信値と条件変更の結果が維持され、候補移動や再選択で余計な業務処理を起こさない。
- touch、拡大、forced colors、読み上げで選択が成立する。装飾を増やした結果、文字や選択状態を追いづらくしない。
- production buildで配信量の差を確認し、共通化に不要な機能や別のmotion engineを追加しない。

対象ブラウザーは要求どおり最新安定版Chrome / Firefox / Safari / Edge。現在のPlaywright設定はDesktop Chromeのみなので、その成功だけで全対応環境の保証とはしない。E2EはPlaywright MCP、見た目は同MCPまたはcontrol-chromeを使い、実機touch・支援技術の未確認範囲は分けて報告する。

今回は規約・production source・インストール済みBase UI・公式資料の調査まで。カスタムSelectの実装、比較試作、利用者テスト、ブラウザー・実機検証はまだ行っていない。

## 8. 抽象化の移行耐性の補足診断

software-design-philosophyの8観点では、今回確認した現行境界の充足は3/8（3.75/10、うち1項目は未確認）。これは**nativeからカスタム実装へ置換する際の局所的な設計診断**であり、現在のnative操作の品質やアプリ全体の評価ではない。nativeを標準とした現在のAPIに依存があること自体は、現行方針下の欠陥とは限らない。

| 観点 | 今回の確認 | 採用時に満たすための変更・確認 |
| --- | --- | --- |
| 責務を一文で説明できる | 充足 | Fieldの説明関連付けとControlの操作・表示を維持 |
| APIが内部の複雑さより小さい | 未充足 | 広いnative属性・children契約を、必要な単一選択APIへ限定 |
| 内部実装を変えても利用側に波及しない | 未充足 | DOMイベント、select型判定への依存を明示的に移行し、新しい依存を漏らさない |
| インターフェースが約束を説明する | 未充足 | 値確定、空文字、ref、フォーム、keyboardの契約をAPIの近くに記す |
| 設計の複雑さをレビューする | 充足 | 本検討で方式と責務を比較。実装レビューでも公開APIと例外を確認 |
| 部品が重要な設計判断を隠す | 充足 | 現在の境界・toneに加え、popupとfocusの判断もsharedへ閉じる |
| 実装を読まず部品境界を理解できる | 未充足 | 入力表とのキー優先順位、可視triggerのref、portal責務を明文化 |
| 設計改善に継続して時間を配分する | 未確認 | 実作業の配分は未計測。点数のための時間割を導入せず、移行後のレビューで保守負担を確認 |

全項目の充足は、APIを小さくしたという計画だけでは判定しない。統合後の実装とレビューで再評価する。
