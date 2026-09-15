# 選択肢表示の共通化 — 実装計画

状態: 実装済み。2026-09-15策定、2026-09-16実装・検証。第1〜4段階を実施し、利用可能なChromium環境で代表操作と外観を確認した。実装結果と未検証範囲は第8節を参照。

方式比較と現行コードの調査は [調査記録](ui-select-review.md) を参照する。本書は実装する範囲、変更順序、受入条件を扱う。表示・操作契約は [UI規約](ui-rule.md)、責務は [architecture](architecture.md) へ反映済み。

## 1. 到達点と範囲

既存のBase UI Selectを操作基盤として、一行ラベルの単一選択をshared UIへ統一する。閉じた欄の控えめな外観を維持し、開いた候補の文字・余白・現在値・操作位置・取消をアプリ内で揃える。

対象は `SelectField` の25利用箇所と、試合入力表の `SelectControl` 直接利用4箇所。前者には共有の表示件数・開発用アカウント選択も含む。実装開始時に差分を確認し、追加された同種の利用を取りこぼさない。

開催・試合の候補選択ダイアログ、radio、tabs、segmented control、日時inputのpickerは対象外。検索、複数選択、仮想化、開閉アニメーション、新しい通知は追加しない。候補表示のための新しいライブラリ、画面ごとのnative/custom切替、汎用overlay frameworkも導入しない。

## 2. 確定した操作方針と設計判断

### 試合入力表の選択欄のキー割当

利用者の回答により、「メンバー」「プレー順」は他の選択欄と同じ操作に揃える。選択欄上のEnter・上下による従来のセル移動を変更し、数値入力の既存操作は維持する。

| 対象・状態 | 確定した操作 |
| --- | --- |
| 閉じた選択欄 | Enter / Space / 上下で候補を開く。Tab / Shift+Tabで文書順、左右で同じ行の隣の欄へ移動 |
| 開いた候補 | 選択・候補移動・取消を共通Selectが所有し、表のセル移動へ渡さない。Tab / Shift+Tabは未確定の候補を採用せず閉じ、次／前の操作へ移動 |
| 数値入力欄 | Enter・矢印による移動、Escによる編集の取消など、既存の操作を維持 |

入力表の操作ガイドと検証もこの区別へ更新する。入力表専用の選択モードや、従来キー操作へ戻す設定は設けない。

### 実装側で決めること

- popupは原則下・左揃え、上下の空きに応じて反転する。PC/mobileで同じ部品を使い、viewportとpointerに応じて寸法を適応する。
- 開閉は即時。反応の文法に沿うhover補間だけを使用する。
- 値の確定と候補移動を区別する。通常の選択に確認ボタンやToastは足さない。
- ダイアログ内の描画先と重なり順はsharedが解決し、featureに選ばせない。
- Base UIの型・実装に関する未確認事項は第1段階の技術検証で解消する。受入条件内の修正は実装側で進め、キー契約や対象端末など利用者の条件を変える必要が生じた場合だけ相談する。

## 3. 共通の操作・表示契約

### 選択と移動

| 操作・状態 | 完了時に守る結果 |
| --- | --- |
| 欄を押す / Enter / Space / 上下 | 候補を開き、現在値または操作可能な候補へ移れる。開くだけでは値を変えない |
| 開いた候補で上下・Home / End・文字キー | 候補を移動する。業務値、URL、入力結果はまだ変えない |
| 候補をclick / tap、またはEnter / Spaceで選ぶ | 値を確定して閉じる。同じ値なら値変更通知を増やさない |
| Escape | 未確定の候補移動を取り消して閉じ、欄へfocusを戻す。親dialogは同時に閉じない |
| Tab / Shift+Tab | 未確定の候補は採用せず閉じ、文書の次／前の操作へ移る。triggerへfocusを引き戻さない |
| 外側を押す | 候補を閉じ、未確定の候補は採用しない。その押下で背後の操作まで実行しない |
| 閉じた欄で文字キーによる候補選択 | Base UIのtypeaheadによる値確定を維持する。開いた候補の移動とは区別する |
| disabled / 無効候補 | 値を変更できない。候補の無効状態と現在値を読み取れる |
| 候補更新 / 条件変更 | 値の維持・リセットは既存featureの判断に従う。共通部品が先頭候補を勝手に選んだり、副作用を起こしたりしない |

上記は採用するアプリの契約であり、検証済みの組合せは第8節に限定する。インストール済みBase UI 1.8.0とContext7の公式資料で、候補移動と値確定が分かれ、閉じたtypeaheadは値を変える実装を確認した。Tab、pointer、入れ子のfocusは実browserで受入条件を確認する。キー処理をサンプルから作り直さず、公開APIと必要最小限の接続で成立させる。[Base UI Select](https://base-ui.com/react/components/select)

### 外観と寸法

- triggerは現在の選択用枠、矢印、tone / invalidの優先順位、密度、文字サイズ、左右の余白を維持する。値の長さや開閉で周囲の欄を押し動かさない。
- popupは既存surface・border・`rounded-sm`・浮遊面のshadowを使う。内余白は4px、欄との間隔は4pxを初期値とし、既存4px scaleに揃える。任意の新しい色・影の参照値は追加しない。
- 候補行は既存controlに合わせ、fine pointerでは40px以上、coarse pointerでは44px以上の操作領域とする。文字は長ければ折り返し、横スクロールで読ませない。
- 候補のcheck列は全行で幅を揃え、現在値にだけcheckを表示する。候補行以外や閉じた欄へ不要なicon用空白を増やさない。
- popupは少なくともtrigger幅を持ち、長い候補にはviewport内で必要な幅を与える。利用可能な高さと既存spacing scaleの上限で内部スクロールさせ、選択項目を表示範囲に収める。viewport端、拡大、safe areaでは収まることを優先する。
- 現在値はcheckとselected surface、操作位置はfocus-visible、pointerは既存hoverで区別する。Base UIのhighlightを一律にhover扱いせず、pointerとkeyboardを往復しても二つの操作位置が競合しないことを確認する。
- hoverは既存の100msと `useSurfaceFeedback`、focus・選択・errorは即時。reduced motionとforced colorsでも現在値・操作位置・無効状態を判別できること。開閉で矢印を新たにアニメーションさせない。

## 4. 実装の責務と変更先

### sharedの構成

`SelectField → SelectControl → Base UI Select` とし、入力表は `SelectControl` を直接利用する。

| 変更先 | 内容 |
| --- | --- |
| `shared/ui/forms/SelectControl.tsx`（新設） | 候補、値、確定、可視trigger、popup、フォーム連携、focus、局所feedbackを所有 |
| `shared/ui/forms/SelectField.tsx` | 現在のField構造を保ち、label・説明・errorを可視triggerへ接続 |
| `shared/ui/forms/Control.tsx` と内部presentation定義 | native selectを最終的に削除。Input / Textareaと共有する境界・tone・密度の定義を内部ファイルへ切り出し、外観の二重管理を避ける |
| `shared/ui/feedback/DialogLayer.tsx` と必要な内部context | dialogに所属するpopupの描画先と重なり順を解決。dialog / alert dialogのexit・focus契約を維持 |
| `styles.css` | 既存token・surface状態の接続。必要なpopup内の状態とlayer役割だけを追加 |
| `ScoreGrid` とdesktop/mobileの選択欄 | 可視triggerのref、選択API、キー割当、OCR・validation誘導、操作ガイドを更新 |

公開APIは文字列の `options` / `value` または `defaultValue` / `onValueChange` を基本とする。必要な `name`、フォーム属性、label/description関連属性、disabled / invalid / presentation、可視triggerへのref・focus接続を残す。controlledとuncontrolledの値ownerを一意にし、Base UIの全propsや任意のoption children、偽のnative change eventを公開しない。

入力表へのkeydown接続はtrigger自身の未処理キーに限定し、popup内やIME操作を表へ流さない。選択操作はsharedが所有し、左右移動と閉じた欄のCtrl/Cmd+Enterによる確認先へのfocusはfeatureが所有する。開いた候補でCtrl/Cmd+Enterを押しても、表側の確認・送信を起こさない。

`data-validation-path` と外部refはwrapper・フォーム連携用inputではなく可視triggerへ置く。入力表の `HTMLSelectElement` 判定を廃止し、数値入力のキャレット条件と選択欄の移動条件を明示して分離する。候補へのfocus移動でOCRの確認済み判定や画像選択が意図せず変わらないことを守る。

### フォームとデータ

- `name` 付き5箇所の初期値・空文字・送信値を固定する。別名作成でnativeの先頭選択に依存する箇所は既存の先頭値を明示する。
- フォームのresetと再mount、成功後の初期化、失敗時の入力保持をそれぞれ確認する。Base UI単体で不足するreset連携はshared内で補い、偽のchange eventや各フォームの個別修正で吸収しない。
- 空文字の「すべて」「未紐付け」「未選択」を維持する。既存の必須判定、値の変換、依存条件リセットは変えない。
- 候補が一時的に失われた場合、raw IDを利用者向けラベルとして表示したり、最初の候補へ自動変更したりしない。既存の選択ラベル・復旧表示を移行し、値の正規化はfeature側のままとする。
- 既存のquery / cache / Suspense / Toastのownerを動かさない。候補の開閉・highlightを再取得の契機にしない。

### popupとdialog

通常画面は既存dropdown layerを使う。dialog内では、owning dialog単位のlayerに専用portal hostを置き、スクロールする本文や切り抜かれるsurfaceの外へ描画する方式を第1候補とする。既存の `Dialog.Portal` を使い、後から開くdialogは前の候補より上になる構造を確認する。

Base UIのネストしたfocus・outside interactionの管理と接続し、選択肢を親dialogの外側操作と誤認させない。dialogの退出時には候補も直ちに非対話化し、候補だけが残らない。feature用のz-index props、全dropdownを全dialogより上にする固定値、document全体の手製イベント監視は追加しない。

`modal` は背景への押下の貫通を防ぐ設定、`alignItemWithTrigger` は無効を基本とする。公開API内の調整と既存dialog層の局所変更で成立させる。portal hostの具体的な配置は、clip・focus・重なり順の三条件を実browserで確認して確定する。

## 5. 実施順序とコミット単位

### 1. 共通部品と難所の成立確認

- 現行buildの配信量と、代表画面のtrigger配置を比較用に記録する。
- 新しい `SelectControl`、共有presentation、必要なdialog接続を実装する。試作を別の使い捨て部品にせず、最終部品として育てる。
- 入力表、非制御フォームを持つdialog、URL・依存候補を変更するfilterの3文脈で接続を検証する。通常の候補に加え、長い日本語・機器名、スクロールする候補、無効候補を含める。
- 完了条件: §3の操作、フォーム送信、clipとfocus、確認済みの入力表キー契約が成立する。技術的な不成立を残したまま他画面へ展開しない。
- コミット目安: 共通Selectと必要な基盤・検証。既存nativeの利用箇所は次の移行まで保つ。

### 2. SelectFieldの25箇所と正本の移行

- SelectFieldの接続先と、各利用箇所のイベントを値APIへ変更する。5箇所の非制御フォームを含め、業務的な初期値と副作用を維持する。
- UI規約に共通Selectの適用範囲・確定と取消・状態表示を反映し、architectureのBase UI ownerへselectを加える。
- 既存lintのfeatureからBase UIを直接importしない制約を使う。検査が既に守る境界のために別のcheckerを増やさない。
- 完了条件: 一覧・比較・OCR設定・カメラ・管理・出力・共有の表示件数／アカウント選択が共通部品へ接続され、関連component testが通る。
- コミット目安: 通常選択欄の移行と規約。

### 3. 入力表4箇所の移行とnative実装の撤去

- メンバー・プレー順のdesktop/mobileを移行する。ref登録、label、validation、OCR誘導、プレー順更新に伴うOCR事件簿の再同期を確認する。
- 確定したキー契約へ接続し、実際の操作と一致する案内文へ変更する。
- 古いSelectControl実装と不要な型・option children・native select専用testを撤去する。移行専用の互換APIや設定を残さない。
- 完了条件: 25+4箇所が一つの共通Selectに揃い、数値入力とOCRの既存契約が維持される。
- コミット目安: 入力表移行と旧実装撤去。第2段階までの混在状態を完成・配布可能とは扱わない。

### 4. 代表flow・見た目・配信結果の確認

- §6の検証を実行し、今回の変更に起因する問題を修正する。試作時の証拠は対象コードが同じ部分のみ再利用する。
- 文書に最終API、方式の確定、検証結果と未検証範囲を記録する。修正があれば内容のまとまりでコミットし、検査の再実行だけの空コミットは作らない。
- 完了条件: 必須gateと選択した受入条件を満たす。未実施の端末・支援技術は実施済みに含めない。

## 6. 必要な検証

| 境界 | 主に守る結果 | 証拠 |
| --- | --- | --- |
| 共通Select / Field | keyboard、確定・取消、同値再選択、label / error、可視ref、disabled、空文字、フォーム送信・reset | 共有component testとbrowser操作。全画面へ同じケースを複製しない |
| 入力表・OCR | 選択欄のEnter・上下が表移動を起こさず、閉じた欄のTab・左右で移動できる。数値入力の従来操作、対象プレーヤーへのfocus、review状態、プレー順確定時の既存の数値再同期を維持 | 既存ScoreGrid testの更新とPlaywright MCPのdesktop/mobile代表flow |
| dialog内フォーム | 候補が読める・押せる、Escape一回で候補だけ閉じる、外側押下の貫通なし、正しいFormData、エラー時の値保持 | 共有dialogの入れ子検証と管理フォームの代表操作 |
| 一覧・比較・出力 | 条件・URL・依存候補・出力対象が正しく更新される、取消や同値選択で余計な処理をしない | 影響する既存component / E2Eを更新。取得待ち・通知の既存挙動も確認 |
| 外観と端末 | 欄の配置維持、長文、viewport端、内部scroll、hit target、選択と操作位置の識別 | production buildでwide / narrow、coarse pointer、拡大、forced colors、reduced motionを実確認 |
| 配信・境界 | 必要なCSSが残り、不要な依存・motion engine・feature直書きを増やさない | build、bundle差分、既存lintとコードレビュー |

既存の `selectOptions` / `selectOption` は、role / labelから開いて候補を選ぶ操作へ置き換える。assertはDOMの見かけやクラス名へ弱めず、値・送信結果・URL・focusなど利用者の結果を維持する。

Web gateは `pnpm --filter web format:check`、`pnpm web:lint`、`pnpm web:typecheck`、選択した `pnpm web:test -- <対象>`、`pnpm web:build`。主要flowのE2EはPlaywright MCPで実行する。文書変更には `git diff --check` と `pnpm public:safety:check` も実行する。不要なAPI・DB変更やそのgateは追加しない。

Chromeで主要flowを確認し、Firefox / Safari / Edgeでは共通Selectとdialog・フォームの代表契約を確認する。全画面と全端末の直積は要求しない。mobileの配置とpointer emulationだけでOSの選択体験や読み上げまで保証せず、iOS / Androidの実機操作・支援技術で確認した組合せを明記する。現在のPlaywright設定がChromeのみである点を踏まえ、利用可能な検証環境を第1段階で確認する。

## 7. 計画の確定状況

- 方式、対象、共通部品の責務、段階的な移行、検証範囲: 本計画で具体化済み。
- 利用者への確認事項: 解消済み。入力表の選択欄も他の選択欄と揃え、数値入力の操作は維持する。
- 実装時に実測・技術検証する事項: portal hostの配置、フォームreset連携、混在入力でのfocus表示、候補の寸法、browser / 実機の成立とbundle差分。未確認の実装結果を計画上の保証としない。

## 8. 実装結果と検証記録

### 完成した構成

- `SelectField` 25箇所と入力表の直接利用4箇所を共通 `SelectControl` へ移行し、productionのnative selectと互換APIを撤去した。日時input・豊富な情報を持つ候補選択dialogは従来の部品を維持する。
- `options`、文字列の `value` / `defaultValue`、`onValueChange` に値契約を限定した。可視triggerにlabel、error、validation path、refを接続し、フォーム送信はBase UIのinput、uncontrolledのreset連携はsharedが所有する。
- dialogのportalを局所的な重なり順の単位とし、`BaseDialog.Popup` 内でスクロールするsurfaceの隣にfloating用hostを置いた。候補は`positionMethod="fixed"`で配置する。Selectのportal全体でpointerを受け、Base UIの透明backdropが背後の操作へのクリックを遮る。
- popupのmount管理はBase UIへ残し、閉じた欄のtypeahead・autofill経路を壊さない。閉じた候補は即時にhiddenとし、無効化・dialog退出でも操作対象を残さない。
- Base UI 1.8のShift+Tabはtriggerへ戻るため、このキーに限り公開APIの`preventBaseUIHandler()`を使い、triggerを起点にブラウザ標準の後方Tab移動を通す。候補探索・文書内のfocus先探索は自作しない。数値入力のキー契約は変更していない。
- 既存の選択用境界、hover、selected、focusのtokenを接続した。強制カラーモードのselected行にはシステム色を明示し、文字の背景補正でラベルが読めなくなることを防いだ。

### 検証と保証範囲

| 境界 | 実施内容・結果 |
| --- | --- |
| 共通部品 | 候補移動と確定の分離、Escape、Tab、同値、disabled、未知のID、空文字、controlled / uncontrolled、可視ref、FormData、reset、dialogの一層ずつの取消をcomponent testで確認。閉じた欄のtypeaheadでは無効候補を飛ばすことも確認 |
| アプリの既存接続 | 全Webテスト158ファイル・884件が成功。入力表のメンバー変更、数値入力・選択欄のキー分離、OCR確認画面、非制御フォームの送信・失敗時の保持など、既存の業務値assertを維持して移行 |
| Playwright MCP | Chromiumで、試合一覧の条件・URL更新と取消、比較シーズンの値・URL更新と取消、出力対象の表示、OCRオーナー変更、入力表の左右移動・数値欄のEnter移動・mobileのOCR対象へのfocusを確認。管理dialogでは選択値を送信して一覧の紐付け結果を確認し、再度開いた際の初期化も確認 |
| 描画とfocusの回帰 | production buildで、Tab / Shift+Tabによる次／前の欄への移動、wide / narrowで候補の外側を押した際のクリック遮断を確認。タッチ操作時にtriggerの位置が動かないことを確認。これらを既存E2E suiteにも回帰ケースとして追加 |
| 表示条件 | 1440px幅・375px幅、coarse pointer、長い日本語を含む26候補、内部scroll、上下反転、Endで末尾候補へ移動して確定、reduced motion、forced colorsを確認。候補行はfineで40px、coarseで44px以上。2倍のvisual viewport拡大でも代表候補が表示範囲内に収まることを確認 |

ブラウザ操作は既存MSW fixtureを使ったフロントエンド境界の確認であり、実API・DBへの保存や実カメラの検証ではない。検証用のbootstrap、worker、画面は検証後に撤去し、製品へ含めていない。実行可能だったMCP環境はChromiumで、Firefox / Safari / Edge、iOS / Android実機、screen reader、ブラウザの表示倍率設定・OSの文字拡大は未検証。これらをemulationの成功で代替したとは扱わない。

format、lint、typecheck、production build（built theme検査を含む）、`git diff --check`、公開情報検査も成功。

### 配信と維持負担

追加のpackageはない。同条件のproduction build比較では、全JS chunkのgzip合計は532.24kBから543.59kBへ約11.35kB増、CSSのgzipは12.42kBから12.61kBへ約0.19kB増。chunkの共通化も変化し、entry単体は112.29kBから140.77kBとなった。全chunk合計は初回転送量ではなく、entry差分もSelect単体の増分とはみなさない。既存の分析schema chunkに対する500kB警告は継続している。

全体検証で既存の分析ビューtestに不足していたRouter文脈を補い、遅延ロード完了待ちの上限を整えた。前者は2件のRouter wrapper追加、後者は既存の完了条件を維持した待機上限の変更であり、製品のルーティング・待機表示は変更していない。
