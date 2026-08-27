# Web UI / UX 規約

目的: momo-result の全画面で、同じ意味・状態・操作を一貫して表し、記録、確認、比較、出力を迷わず完了できるようにする。

本書は Web の横断的な意味表現、視覚階層、操作文法、安全性、状態表示の正本である。業務用語・状態遷移は `docs/domain-rule.md`、画面固有の目的・順序・指標は対象要求、実装境界は `docs/architecture.md`、検証方針は `docs/test-rule.md`、実行コマンドは `docs/dev-rule.md` を正本とする。コンポーネント、トークン、フォーマッターの現在値は実装と checker を正本とし、本書へ複製しない。

規則が競合する場合は、正確性・データ保全・利用者の制御、アクセシビリティとタスク完遂、意味の一貫性、視覚上の洗練の順で判断する。統一感とは同じ意味が同じ原則で働くことであり、異なる文脈を同じ外形へ押し込むことではない。

## 1. 製品の方向性と意味

- 主な利用場面は、4人の仲間が1試合ごとに OCR 取り込み、下書き確認、確定、次の対戦を繰り返し、開催分が揃った後に累積結果と傾向を囲んで振り返る時間である。この流れを分断せず、記録から雑談と仮説の発見までを支える。
- 製品は汎用ダッシュボードではなく、静かな対戦卓に置かれた、作り込まれた試合台帳として設計する。落ち着き、明瞭さ、精度を優先し、派手な演出、焦点の定まらない構成、AI Slop に見える定型意匠を避ける。
- 注目対象は利用段階に合わせる。取り込み・確認中は現在の OCR 状態と次の修正または確定、確定後は累積結果、開催分が揃った後は結果を裏付ける比較と傾向を主役にする。異なる段階の主要情報を同じ強さで競合させない。
- トップページに確認可能な OCR 下書きがある場合は、現在の開催回に属するものを優先し、同じ開催回では試合番号が小さい未確認下書きを先にする。OCR 状態、開催日時、試合番号、確認または確定への1操作を最初の視覚的な錨にする。累積結果は進行を妨げない二次情報とし、下書きがない場合だけ現在の開催または累積結果を主役にする。
- 開催回、試合番号、OCR、下書き、確定、順位、結果、出力という業務語彙を使う。UI では対象、親スコープ、現在状態、実行可能な次の操作を判断できるようにする。
- 同じ意味には共通の意味トークン、フォーマッター、アクセシブルな primitive を使う。表示部品は再利用を優先するが、情報量や操作文脈が異なる場合は、意味と挙動を保ったまま構成を変えてよい。
- 利用者または保存済みデータが提供していない指標、件数、原因、信頼度、推薦を UI 都合で補完しない。不明、未分類、計算不能、対象なしは、その状態を明示する。
- PC、タブレット、モバイルで配置が変わっても、情報、状態、操作、現在地、戻り先の意味を変えない。モバイルでは主要情報を削らず、再配置、必要な横スクロール、段階的開示、要約と詳細の対応で情報量を保つ。
- 構造、ラベル、境界、整列、accessible name で意味を伝える。主要操作や未知の操作を説明不要として隠さない。

## 2. 現在地・視覚階層・情報表現

### 2.1 読解順と強調文法

- 画面タイトル、グローバルナビゲーションの現在地、必要な親スコープ、主要な検索・絞り込みを、初見でも判断できる位置へ置く。詳細画面は安全な戻り先を持つ。
- 画面の主役は利用段階で決める。未完了の取り込み、確認、編集では次に完了すべき操作を第一視線にし、確定済みの閲覧、結果、比較では判断対象となる結果を第一視線にする。結果と操作が共存しても同じ強さで競合させない。
- 初期表示範囲に画面全体の視覚的な錨を原則1つ定める。錨は見出しを飾る容器ではなく、現在の目的に対する主要結果、主要操作、または現在状態そのものとする。4人比較など同格の反復要素は一つの比較群として扱い、各要素を等しくしても、その外側へ同じ強さの錨を重ねない。
- 強調は次の3段階で組み立てる。
  1. **主焦点**: 位置、読み順、周囲の余白、文字の大きさまたはウェイトを優先する。主要操作の場合だけ高コントラストの塗りを使ってよい。
  2. **内容構造**: 見出し、整列、関係的余白、列でまとまりと順序を示し、それだけでは別の範囲と誤認する場合にだけ divider を補う。通常の section や説明を淡色面で囲わない。
  3. **局所標識**: 選択、現在状態、順位、分類、注意などを、短いラベル、marker、icon、compact な fill または border で走査可能にする。局所標識を section 全体の強調へ拡張しない。
- 文字の大きさ、ウェイト、コントラストを常に同時に最大化せず、3つすべてを使うのは画面の主焦点に限る。ラベルは値より、補足は本文より、metadata は判断材料より明確に弱める。色を除いた grayscale と blur でも主焦点、比較群、補助情報の順序が残ることを先に成立させる。
- 強調の総量を相対評価する。同一のタスク範囲で最大強度の表現は1つとし、新しい強調を足す場合は既存要素のいずれを弱めるかも決める。初期表示範囲に独立した大きな淡色面を複数並べず、例外的に同格比較へ反復する場合は、反復群全体を一つの錨として読み取れる構造にする。
- 内容のない kicker、section 番号、大文字ラベル、同じ強さの KPI card や CTA を反復しない。重要であることを面積や装飾だけで主張せず、その要素が伝える結果、状態、操作を第一視線で読めるようにする。

### 2.2 色、面、境界、装飾ラベル

- 機能から参照外の色や一回限りの色値を直接指定せず、参照色、意味トークン、コンポーネント用途の順に参照する。操作色は選択、フォーカス、操作可能性の強調に限定し、色だけで状態、系列、順位、警告、選択を伝えない。
- 視覚基盤は light mode のみとする。白に近い canvas、無彩色から低彩度の neutral surface、十分な明度差を持つ text と border で端正に構成する。neutral の参照色は OKLCH の明度順に段階化し、canvas、surface、inset / selected、text、border、control、action の役割へ割り当てる。主要操作は高コントラストの dark neutral を基本とし、dark theme と theme switch は設けない。
- 4人を並べる基準色順は `1=青`、`2=赤`、`3=黄`、`4=緑` とする。固定メンバーを canonical 順に並べる表示ではこの順を member sequence として使い、各試合のプレー順を表す表示でも同じ順を play-order sequence として使う。共通する色順によって4人表示への馴染みを保つが、固定メンバー上の位置と試合ごとのプレー順は別の意味として扱う。
- member sequence と play-order sequence は同じ4色の参照 palette へ対応してよいが、意味トークン、formatter、label、component は分離する。固定メンバー主体の結果・比較・グラフでは member sequence、番手や画像内の並びが主体の入力・分析では play-order sequence を使う。同じ行、表、比較群でプレーヤーとプレー順を同時に示す場合は play-order sequence だけが4色アクセントを所有し、プレーヤー名は neutral にする。名前と `プレー順N` の文字、marker の形または配置も併用し、色だけでどちらの順か判断させない。
- 順位は固定メンバー順やプレー順とは別の尺度であり、この4色順へ対応させない。rank は独立した意味トークンと `N位` の文字・形で示し、同じプレーヤーに付く member / play-order marker と取り違えない表現にする。任意のグラフ系列、操作、状態、傾向、装飾にも4色順を流用せず、4人の固定メンバーを表す系列だけを member sequence の用途に含める。
- 操作、状態、順位、汎用グラフ系列、member sequence、play-order sequence は別の意味トークンを持つ。参照値の共有は上記2つの sequence 間だけに明示的に限定し、その他は同じトークンや値を alias しない。error、warning、success は sequence 色と明確に区別できる範囲で赤、黄、緑の色相を使ってよいが、ラベル、アイコン、形を併用し、sequence 色と同時に表示して取り違えがないことを検証する。区別できない組み合わせは neutral を基調にする。文字と面、control、focus、graph mark は実際の組み合わせで contrast と色覚多様性を検証する。
- 淡色背景は、選択中または現在の scope、状態・通知・注意、入力や操作の inset、および compact な装飾ラベルに限定する。通常の要約、説明、見出し、重要情報は、重要という理由だけで淡色面へ置かない。面を追加するときは「何の選択・状態・操作領域・局所標識か」を答えられなければ使わない。
- disclosure / collapsible は情報を開閉する操作であり、それ自体を選択状態や inset とみなさない。`Collapsible.Panel` に相当する展開内容は背景を所有せず、周囲の面をそのまま使う。feature や filter から panel 自体へ淡色背景を上書きしない。実際の状態、注意、独立した操作領域を内包する場合だけ、その内側の該当要素へ淡色背景を付ける。enabled trigger は文字階層や用途variantによらず同じ淡色hoverを持ち、行全体が操作可能であることを即時に返す。hoverは一時的なpointer feedbackに限り、展開中の固定背景やpanelの面へ転用せず、disabled triggerでは出さない。
- `1位`、`2位`、分類名など、短く反復され、走査や識別を助けるラベルは局所的な標章として背景色、形、border を持ってよい。標章は文字だけでも意味が分かり、同じ種類で一貫した寸法と強度を持ち、clickable、selected、warning と誤認させない。広い面へ装飾を拡張せず、識別やリズムに寄与しない badge は足さない。
- page canvas は、global navigation、戻り先、画面見出し、page-level action と content 間の余白を受け持つ。主要な作業・結果・data は白い content surface に置き、連続した1タスクまたは1 data scope につき原則1面とする。画面見出しは原則として content surface の外に置き、面をまたぐ下線を既定で持たせない。
- table が主要内容の一覧・管理画面も page header から table を直結せず、通常の内余白を持つ content surface の内側に table を置く。table は上端、header 下端、最終行下端の横罫線を所有し、外周の枠線と角丸は持たない。loading、empty、error、pagination は同じ data scope の面と余白に従属させる。`padding="none"` は、workspace や全面表示など child が外余白を所有する明確な理由がある場合だけ使う。
- content surface の内側を通常 section ごとの白い card に分割しない。まず見出し、整列、列、関係的余白で構成し、同時に独立して扱う source / editor などの workspace、独立して反復する record、境界が操作の理解に必要な bounded panel に限って別面を許容する。empty、pagination、loading など親 scope に従属する状態・操作は、親の白面を重ねて作り直さない。
- グルーピングは整列と余白から始める。divider は、隣接内容が余白と見出しだけでは同一群と誤認される場合、table の row / column、control、状態通知など境界自体が意味を持つ場合に限る。通常 section を上下線で挟まず、必要なら片側1本を使う。
- 1つの視覚境界は1つの owner だけが描く。親 surface の外周と先頭・末尾 child、disclosure の root と panel、table wrapper と隣接 toolbar などへ同じ境界を重ねず、隣接する平行線や二重線を作らない。淡色背景、border、角丸を同じ要素へ慣習的に重ねず、境界を伝えるために必要な最小の手段を選ぶ。
- shadow は dialog、tooltip、toast など浮遊 UI に限定する。通常内容に elevation を足さず、gradient、glow、大きな surface contrast を装飾に使わない。

### 2.3 文字、余白、データ表現

- 一次情報、補助情報、ラベル、placeholder、disabled を既存の文字トークンとウェイトで階層化する。見出し、本文、ラベル、データの役割を固定し、本文と control は regular 以上を使う。小さい文字は補助 metadata に限定し、主要結果、操作、エラーを細字や低コントラストにしない。
- 余白は定義済み token を使い、密接な要素よりグループ間を大きくする。page、data surface、workspace は一貫した外余白の内側で利用可能な横幅を使い、読み幅の制約は prose、単一 field 群など幅を狭める理由がある内容へ局所的に掛ける。画面全体を文章幅へ縮めず、試合間・プレーヤー間の走査や比較が速くなる表・図表は一貫して密にする。不規則な欠け、根拠のない非対称、任意の値や z-index を追加しない。
- page 幅は内容形状に応じた少数の共通 variant に収束させる。単一の短い form / prose は narrow、通常の一覧・管理・取り込みは standard、横比較・詳細分析は wide、source と editor を常時並置する編集 workspace だけは workspace を使う。同等の画面は同じ variant を使い、内部の短い prose や単一 field だけを局所的に狭める。利用可能幅を埋めるためだけに workspace を選ばない。
- responsive layout は、可変列に `minmax(0, 1fr)`、child に縮小可能な幅を与え、label や操作名が不自然に割れる前に列を積み替える。breakpoint は端末名ではなく内容が保てる幅で決める。page 全体の横 scroll は作らず、table、図表、source image など横方向の関係を保つ必要がある領域だけが、可視の案内とともに局所 scroll を所有してよい。
- 通常文を任意の位置で強制改行しない。ID、URL、外部 error など切れ目のない長い値だけへ局所的な wrap または scroll を指定し、全画面へ `overflow-wrap: anywhere` を継承させない。見出しの balance や本文の pretty wrap も、data label、定義値、control label へ一律適用せず、役割ごとに指定する。
- 一行として走査する control、status、action cluster、通常の table cell は中央、文字同士の短い label / value 行は baseline、heading と lead や主情報と metadata からなる可変高の複合 record は上端を揃える。field を横に並べる form row は control の下端を揃えてよい。table editor の上端、chart axis の下端など対応関係のための例外は局所的に明示し、画面ごとの任意な offset で調整しない。shared interactive primitive が文字サイズ、行高、responsive な高さを所有し、global element selector の font shorthand で上書きしない。
- 日時、金額、試合番号、状態名は共通 formatter / ViewModel を使う。件数と比較値には対象、単位、分母または基準を添え、整列する数値には tabular numerals を使う。
- table は row / column header と identity を保つ。グラフは答える問いがある場合に使い、数値表現を併記し、比較軸、単位、スケールを揃える。モバイルへ再配置しても、プレーヤーと試合の対応、比較順、詳細への到達を失わせない。
- 通常の data table は、親の surface と同じ背景、本文より弱い小さな header 文字、table 上端と header 下端および最終行下端の横罫線で構成する。本文行どうしの横罫線、外周の枠線、角丸、通常 header の淡色背景は付けず、pagination の有無にかかわらず共通 table primitive、body row、header pattern を使う。sortable header の選択表現は操作部分だけが所有し、行全体の背景へ広げない。
- 時系列の連続 timeline は順序付きリストと1列の marker 軸で構成し、connector は隣接する marker の中心間だけを結ぶ。軸を最初の marker より上、最後の marker より下へ伸ばさず、record の枠線や別の縦罫線を平行に重ねない。各 marker は順序を文字でも示し、record heading と対応させる。
- disclosure、tab、dialog、navigation を見た目だけで取り替えない。panel は trigger との関係を保ち、周囲の位置・幅・focus を不必要に変えない。可視見出しを省略する場合も `section`、`aria-label` / `aria-labelledby`、field label、accessible control name で構造を残す。
- 同格の disclosure を列で並べる場合、一つの展開で同じ行の別 trigger や操作が展開内容の下端へ追従しない。各列は自身の内容順を保ち、展開による高さ変化は当該列と後続の共通内容だけへ反映する。
- 主要操作は常時発見可能にし、二次操作だけを段階的に開示する。

## 3. 操作文法とコンポーネント境界

操作文法は、利用者の目的を一貫した操作と結果へ対応させるための横断契約である。共通化は外形や event handler の類似ではなく、目的、対象、作用、開始前と完了後の状態、制約、feedback、失敗時の回復が同じかで判断する。

### 3.1 抽象化の単位と所有権

- 同じ目的、対象への作用、状態遷移、制約、回復方法を持つ操作は、画面が異なっても同じ shared UI primitive または操作 pattern を使う。業務上の結果や制約が異なる場合は、外形を揃えるために一つの操作へ統合しない。
- shared UI は、意味に対応する構造、keyboard / focus、accessible name、hit target、disabled / pending、局所 feedback、responsive な配置を所有する。feature は業務語彙、URL / query / cache、権限、入力変換、副作用、業務状態遷移を所有し、app は route と画面 composition、shared domain は横断する業務 identity、順序、formatter を所有する。
- shared UI へ切り出すのは、複数の現在用途を一つの小さい契約で覆える場合、または単独用途でも accessibility、制約、feedback、状態同期の重要な判断を隠せる場合に限る。名前を付けただけの wrapper、呼び出し元の判断を props へ移すだけの万能 component、将来用途だけを見込んだ schema は作らない。
- primitive、操作 pattern、feature composition の三層で考える。feature は shared UI を組み合わせて文脈固有の操作を作り、shared UI は feature の業務 enum、API DTO、query key、文言一覧を知らない。
- button、link、form control、status、notice、dialog、disclosure は shared UI とアクセシブルな primitive を優先し、機能ごとに同じ keyboard / focus / pending 挙動を手作りしない。

### 3.2 選択・表示切替・表示範囲

- 説明を読み比べて一つを選ぶ候補は、可視 legend を持つ native radio group と説明付きの選択行で表す。選択行全体を操作可能にし、選択状態は control、文字、形で示して色だけに依存しない。候補固有の別操作は選択 label の内側へ混ぜない。
- 開催、試合など日時・件数・状態を読み比べる単一選択は、現在値と変更 trigger を持つ共通 dialog field を使う。任意選択の「すべて」「選択しない」も同じ radio group の候補として扱い、filter、OCR、作成・編集、出力の文脈ごとに別の選択文法を作らない。候補が1画面に収まらない場合は共通の compact pagination で server page を切り替え、page 外へ移った現在の選択と表示 label を失わせない。
- 少数の短い mode 選択のうち、値だけを変えて周囲の内容領域を切り替えないものは segmented control を使う。同じ対象の view を切り替える場合、または選択ごとに直下の候補・結果・実行内容が一つの対応 panel として切り替わる場合は tab を使う。補助詳細の開閉は disclosure、多数の簡潔な候補は select または検索可能な選択を使う。見た目の都合で意味を交換せず、選択と即時実行を混同しない。
- page-local な主要 tab は、設定管理を基準とする共通の filled presentation を使う。tab list 自体を枠や背景で囲わず、選択中の tab だけを selected surface、文字、`aria-selected` で示し、狭い幅では label を分断せず tab 単位で折り返す。同じ panel 内の下位 view は、より弱い underline presentation と局所的な横 scroll を使ってよく、上下2階層を同じ強さの fill で競合させない。
- tab は同じ tab set として tab list、tab、対応する tab panel の関係を持ち、keyboard focus と選択状態を shared UI が所有する。focus 移動だけで即座に表示できる panel は自動 activation を使ってよいが、取得や高コスト処理を始める切替は、矢印キーで focus、Enter または Space で activation する。切替後の取得中も起点 tab の DOM と focus を維持し、stale content の `inert` 化で focus が document へ退避した場合は完了時に起点へ戻す。ただし、利用者が別の操作へ移した focus は奪わない。panel を伴わない排他条件は tab の外観へ寄せるために tab semantics を付けない。
- filter は表示対象の scope を変える操作であり、変更先の data surface の近くへ置く。主要条件、必要な場合だけ開く詳細条件、結果または件数、scope を示す一つの全解除を一つの操作群として対応させる。この「操作群」は意味と配置のまとまりであり、全体を card や淡色面で囲うことを要求しない。閉じると見えなくなる詳細条件は、非既定値だけを disclosure trigger の補助タイトルへ具体的に要約し、開閉中も同じ現在値を保つ。常時見えている主要条件や sort は各 control を表示上の owner とし、別置きの `適用中` 欄へ再掲しない。
- 一覧では data surface を主役とし、filter は同じ content surface 内でそれを支える階層に置く。条件内では高頻度の主要条件、sort、必要時だけ開く詳細条件、件数の順に強弱を付ける。少数で短く、高頻度に切り替える filter は直接選択を使ってよいが、多数または階層的な排他候補は select など一つの共通 control にまとめる。親状態と下位状態を同じ値に対する二重の選択状態として並べない。既定値や可視 control と同じ内容を要約で再び強調せず、詳細条件の要約は閉じた状態で現在値を確認するために必要な強さへ留める。
- filter の件数は取得できた範囲だけを事実として表示する。取得失敗や未取得を `0件` に置き換えず、件数不明であること、表示対象への影響、再取得操作を filter 群の近くで示す。
- 同一 scope の総件数は、filter 要約、一覧 toolbar、pagination など複数箇所へ反復しない。範囲と総数を同時に判断する一覧では pagination を表示上の owner とし、filter 内訳など別の判断に必要な件数だけを別途示す。
- filter の見た目と操作契約は横断化してよいが、URL、query、cache、cursor、候補間の依存、既定値、更新文言は feature が所有する。横断 component に filter schema や query 実装を持たせない。
- sort、page、selection、filter は現在状態が読み取れ、影響領域へ持続的に反映されること。選択中 control の再実行で duplicate load や flicker を起こさず、表示範囲を変えても対象 identity と戻り先を失わせない。
- 取得済み内容を保持したまま filter、sort、page を変える場合は、表示中の scope と要求中の scope を区別して知らせる。同じ scope の更新では安全な操作を保ち、scope 変更により対象を誤認する領域だけを一時的に制約する。見た目だけを残して支援技術から無条件に隠すことを「保持」としない。

### 3.3 移動・実行・確定

- link は場所の移動、button は現在の文脈での実行に使う。icon-only の移動と実行もこの区別を保ち、見た目を共通化しても element の意味を変えない。
- 実行操作は影響する対象の近くへ置き、ラベルで対象と予測できる結果を示す。操作前に必要な制約と影響を示し、押下直後、pending、成功、部分成功、失敗のうち該当する状態を同じ操作文脈で返す。
- form の確定は選択または編集と区別し、pending 中は同じ送信を重複実行させない。dialog 内の確定操作は一貫した footer、読み順、主要度を持ち、pending 中に不用意に閉じて結果を見失わせない。
- 不可逆または高コストな操作は、対象と結果を `AlertDialog` で明示する。安全に可逆な操作は即時反映と Undo を優先し、routine な操作へ確認 dialog を増やさない。

### 3.4 更新・再試行・初期化・破棄

- 更新は、現在有効な表示条件のまま data を再取得する操作である。`ready → updating with stale content → ready` を基本とし、失敗しても取得済み内容を残して更新失敗を局所表示する。初回 loading へ戻さない。
- data の更新は利用者が更新 / 再試行を実行したときだけ開始する。一定間隔、遅延 timer、別 tab からの復帰、window focus、network reconnect を更新操作の代わりにしない。初回表示、mutation 後の cache 整合、失効した immutable resource の bounded recovery は更新操作と区別する。
- 再試行は、失敗した同じ操作を同じ入力と scope でやり直す回復操作である。`error → pending → success | error` を失敗箇所の近くで示し、入力、選択、scroll 位置を保つ。route retry は query と error boundary を同時に reset する。
- 初期化は、利用者が変更できる値を明示された既定値へ戻す操作である。`customized → defaults` の対象 scope をラベルで示し、変更がない場合は主要操作にしない。初期化に伴う再取得は更新 feedback を併用するが、再試行や破棄とは呼ばない。
- 破棄は、未確定または一時的な変更を取り除き、`dirty → clean` へ戻す操作である。失われる内容を先に示し、影響が大きい場合だけ確認を挟む。保存済み data の削除と未保存変更の破棄を同じ文言にしない。
- 更新、再試行、初期化、破棄は、icon、文言、loading 表示を流用して同じ操作に見せない。共通化する場合も、各状態遷移と回復契約を保つ composition に留める。

### 3.5 状態・制約・feedback

- interactive component は、該当する default、hover、focus-visible、active、selected、disabled、pending / loading、error、success を定義する。data surface は loading、empty、error、stale、not found を混同しない。
- 利用可能な操作、対象、現在状態を実行前に読み取れ、押下または選択を直ちに知覚でき、完了結果と次の操作を判断できるようにする。操作の重要度に feedback の強さを合わせ、routine な選択へ toast や dialog を使わない。
- disabled は利用不能な理由を対象の近くに示す。pending は進行中であることを表示し、単に control を無反応にしない。長時間操作は進行中であることと、安全に離脱または中断できるかを示す。
- 失敗は操作箇所の近くに表示し、何が起きたか、影響範囲、次にできることを示す。保存、削除、再取得、download の失敗を toast だけへ逃がさず、同じ結果を toast と inline notice に重複表示しない。
- 補助 metadata や color だけから業務状態を推測せず、明示された状態を表示用の共通表現へ変換する。業務状態の enum や遷移自体は feature / domain が所有する。

## 4. 入力・ワークスペース・アクセシビリティ

- form は可視ラベル、説明、必須、validation error、disabled / pending を同じ field 境界で関連付け、paste を妨げない。checkbox、radio、select、text input は native semantics を保ち、見た目のために keyboard 操作を再実装しない。
- OCR 結果修正と手入力は、入力 field と対応する source image、同じプレーヤー・項目順、編集結果の feedback を一つの workspace として保つ。この対応関係と少ない修正手数を保護し、画面の分断や画像と field の往復を増やさない。
- モバイルの主要操作と icon-only action は 44px 以上の hit target を持つ。icon-only action は文脈を含む `aria-label`、decorative icon は `aria-hidden` を持つ。
- hover で現れる操作や情報は keyboard focus と touch でも到達できる。tooltip は補助説明であり、主要な意味やエラーをそこだけに置かない。
- 複数ステップの flow は Back、キャンセル、完了または安全な中断点を持つ。dialog を閉じた後は起点へ focus を返し、ナビゲーションを阻止する場合は理由と進行状況を示す。
- fixed / sticky UI は safe-area inset を尊重し、focus target や主要操作を viewport 外へ隠さない。狭い幅では再配置して hit target と accessible name を保つ。
- dialog は viewport 側と内容側に二重の縦 scroll を作らず、見出しと閉じる操作を固定した一つの内部 content scroller を owner とする。内部 disclosure の展開もその scroller の高さへ収まり、背後の page scroll を動かさない。全幅 control の focus ring が scroller 境界で切れないよう、共通 content scroller が outline 分の inline gutter を持ち、個別 form で補正を重ねない。
- camera preview、source image、分類 tray など同じ画像を対応付ける frame は、状態や配置前後で aspect ratio を変えない。OCR の撮影 preview と分類 tray は `16:9` を保ち、画像全体を確認できる収め方を使う。
- keyboard、focus、label、contrast、status announcement は WCAG AA 相当を最低基準とする。

## 5. UI ライティングと分析の断定

- 文体は普通の Web アプリとして、短く、具体的に、落ち着いて書く。親しさを演出する冗談や過剰な励ましは足さず、要求正本で定義された `桃鉄型`、`遊戯王型` など仲間内の語彙は一般的な分析語へ言い換えない。
- 一つの文言は、対象、現在状態、結果、影響、次の操作、判断に必要な根拠のいずれかを伝える。同じ事実を heading、lead、notice、button 周辺で言い直さず、正本となるラベルまたは表示を1か所に定める。条件付きの注意は条件が成立した箇所だけに出す。
- `カード表示`、`一覧表示`、`この欄` など容器や表示形式を説明する語は、利用者の判断を変えない限り表示しない。期間と対象を section heading に統合できる場合は `直近8戦と荒れ方` のように内容を直接名付け、同じ範囲を別の fact や lead で復唱しない。
- ラベルと値の組は、値が対象を特定する、判断を変える、または次の行動を具体化する場合だけ置く。値がラベルや隣接構造から自明な言い換えにしかならない組は削除する。たとえば `使う場面: 発動条件に当てはまるとき` のような自己参照的説明を置かず、実際の発動条件をその項目で直接示す。
- 視覚的な強さは情報価値に対応させる。内容が新しい事実、判断、状態、操作を増やさない説明を、背景、見出し、太字、独立 section で目立たせない。期間、対象範囲、単位など解釈を変える前提は一度だけ明示し、その後の各項目で復唱しない。
- 曖昧な構造、不正確な値、欠けた状態、発見しにくい操作を説明文で補償しない。まず構造、コンポーネント、data contract、状態表現を直し、それでも判断に必要な説明だけを残す。
- section 番号への参照、他の表示との重複回避、候補の選別など、生成・編集の内部都合を利用者向け説明にしない。省略や選別が解釈を変える場合だけ、その結果と範囲を対象の近くへ示す。
- 分析文の強さを `事実 → 傾向 → 仮説 → 提案` の順に区別し、要求正本と根拠が許す段階を越えない。仮説は次の対戦で確かめる対象として示し、提案は要求で明示された場合だけ、根拠とともに示す。
- 分析は「分かったこと → 根拠となる試合・件数 → 実戦上の意味 → 必要な場合だけ手法」の順で示し、数学知識を前提にしない。定義済みの判定と根拠がある事実または傾向は会話に近い heading にできるが、観測していない原因や推薦へ広げない。手法名は主要ラベルにせず、必要なら二次 disclosure で平易な説明と対応させる。
- 信頼性は例外として扱う。OCR 品質、data 欠損、分析上の不確かさを別の原因として正本から受け取り、解釈を実質的に変える場合だけ影響範囲とともに警告する。`参考値`、`信頼度低め`、`対象なし` を混同せず、UI が metadata 欠落から健全性を推測しない。通常または十分な状態の安心文言は出さない。
- エラー文は、何が起きたか、影響を受けた範囲、利用者が次にできること、確定していて役立つ場合だけ原因を示す。未確定の原因を断定せず、謝罪、責任転嫁、一般論で要点を埋めない。
- 見出し、ラベル、button、badge は名詞句または短い操作句として句点を付けず、説明、影響、回復方法を述べる完全文は句点で閉じる。件数は対象と単位を空白で分断せず、全体との比は `未確認3件／全8件` のように対象、単位、分母を明示する。
- 保存済みdataを取り除く操作は「削除」、未保存または一時的な入力・画像を取り除く操作は「破棄」、変更可能な条件を既定値へ戻す操作は「初期条件へ戻す」と表す。利用者向け文言とaccessible nameにはcomponent名、design token、内部field、workerなど実装上の呼称を使わない。

## 6. 取得状態・フィードバック・モーション

### 6.1 取得状態とフィードバック

- 取得状態は、表示対象の意味上の同一性に基づいて「置き換える」か「維持する」かを決める。初回表示、または異なる pathname へ移動して新しい内容が未準備の場合は、最終 layout に近い structural skeleton を使う。
- 同一 pathname 内の filter、scope、sort、page の変更と refetch では、既存内容を保って局所的に更新中を示し、全面 skeleton へ戻さない。表示中の内容が新しい条件では誤操作を招く場合は、対象範囲を操作不能にし、更新中であることを文字または status でも示す。
- 一つの loading scope には、その時点で最も局所的かつ因果の近い表示を一つだけ置く。button の pending、spinner、skeleton、toast を同じ待機について重ねず、別 scope の待機は互いの取得済み内容を置き換えない。
- error、not found、empty、stale data を別状態にし、更新と再試行は操作文法で定めた回復契約に従う。
- empty state は現在実行可能で安全な主要操作を1件示し、二次操作は弱める。権限または前提条件で実行不能な導線を出さない。
- 補助情報の取得失敗で、取得済みの主表示を置き換えない。完了結果が画面上で明らかな場合は祝福目的の toast を追加せず、局所的な feedback を優先する。
- transient toast は viewport 上の主要操作、fixed / sticky action、入力中の control を覆わない位置を共通 host が所有する。画面固有の主要操作が下端にある場合は上端へ配置するなど、通知を閉じるまでタスクが停止する重なりを作らない。

### 6.2 モーション

- motion は、操作への即時 feedback、状態の因果、同じ対象の連続性を補助する場合だけ使う。文字、形、位置、accessible state だけで意味を成立させた上で、動いたこと自体を見せ場にせず、注意深く見れば変化を追いやすい程度に抑える。
- 有限の motion は最短の共通 token を既定とし、主に opacity と transform を使う。値そのものの変化を伝える図表や数値は、その mark または値だけを補間してよい。周囲の layout shift、bounce / overshoot、stagger、視線を奪う移動を作らない。
- 利用者の intent と application state は motion より先に反映し、操作可能性、data、route、open、focus、pending、error の変更を animation 完了まで待たせない。motion は中断または省略されても、同じ最終状態と回復操作へ到達できなければならない。
- route content、Suspense の fallback と完成内容、初回 content、一覧 row を、登場または置換そのものの演出として animate しない。異なる pathname の loading は structural fallback、同一 pathname の更新は既存内容の維持と局所 feedback で表す。
- 楽観更新の pending、confirmed、error は、文字、accessible state、disabled、局所 error / retry のうち必要な手段で静止状態でも区別する。同じ安定した identity の `pending -> confirmed` では局所的な属性だけを補間してよいが、追加・削除の presence motion は、rollback、server correction、同時 mutation を含む必要性と正しさを先に検証する。
- viewport への進入を初回 motion の trigger にしない。図表は初めから完成値を描画し、その後、現在表示中の同じ対象に値変更が起きた場合だけ補間してよい。表示領域外で変わった値は完成値へ即時反映し、再進入時に再生しない。
- 常時 loop は処理時間が不定な loading feedback に限り、完了後または対象外になった時点で停止する。非必須 motion は `prefers-reduced-motion` で無効化し、motion を除いても loading、進捗、完了、失敗を同じ精度で判断できるようにする。

## 7. ナビゲーションと有限のタスクループ

- 一覧、詳細、編集、出力、OCR、管理をまたぐ場合は、必要な filter、sort、page、selection、内部 `returnTo` を保持する。`returnTo` は app 内 path だけを受け入れ、復元不能時は安全な既定導線と理由を示す。
- タスクは、きっかけ、最小の操作、確認できる結果、明確な終了からなる有限の流れにする。完了後の連続利用表示、緊急性の演出、予測不能な報酬、再利用させるだけの CTA は追加しない。
- 通知、再訪誘導、保存済み条件、shortcut は、要求で定義した利用者の便益と停止方法を持つ場合だけ使う。FOMO や不安、export を妨げる lock-in を作らず、通常経路と発見可能なラベルを残す。

## 8. 4人の共通結果台帳

- OCR 確認の要約、試合詳細、開催結果、分析では、4人の同一性、順序、整列を共通の視覚文法として反復する。これは同じ card を複製する規則ではなく、文脈に合う表、列、行、図表へ変形してよい。
- 固定メンバーは `いーゆー → ぽんた → あかねまみ → おーたか` の順と名前で識別し、member sequence はこの順に `青 → 赤 → 黄 → 緑` を対応させる。この順序と色順を共通台帳、分析表、4人を表すグラフ系列・凡例へ一貫して適用し、順位、指標値、試合ごとのプレー順で並べ替えない。色は名前を補助する走査用の手掛かりとし、固定メンバーの同一性を色だけに依存させない。
- 固定メンバーを並べる表示の既定順は canonical 順とする。ただし、利用者が列見出しなどの明示された操作で並び替えを要求した詳細表は、その表の範囲に限って指定順を優先してよい。並び替え後も member sequence の色と名前の対応は変えず、現在の sort と既定順へ戻す方法を操作から判断できるようにする。共通台帳、要約、グラフ系列・凡例はこの例外に含めない。
- 試合記録の play-order sequence も `プレー順1=青`、`2=赤`、`3=黄`、`4=緑` とするため、固定メンバーの member sequence と異なる色が同じ人物へ付く場合がある。両者を併記するときは play-order marker だけに4色を使い、固定メンバー名は neutral にする。固定メンバー名と `プレー順N` は別の可視ラベルで示し、順位はどちらの sequence からも独立させる。
- source image と連動する編集 workspace は、対応関係を保つため画像上の並びに合わせてよい。ただし、固定メンバー名と `プレー順N` を別のラベルとして各入力に示し、確定後の結果表示は固定メンバー順へ戻す。結果表示では順位、プレーヤー名、総資産を主情報とし、画面固有の補助指標は対象要求を正本とする。
- 分析の入口は「平均順位の差が縮まったか」「最近の負けが通常より続いているか」「桃鉄型など別の型を試す根拠があるか」という会話へ答えられる構成にする。順位内訳、平均順位と差、直近範囲、総資産・収益を優先候補とし、型の変更は推薦ではなく根拠付きの仮説として示す。
- 前後の差は「改善」「後退」「維持」「初戦」と値を併記し、符号付き小数だけに意味を持たせない。
- 主要結果は同一スコープの比較取得に妨げられず、比較の失敗または対象試合なしでも保存済みの結果を残す。試合の識別情報は文字として残し、ナビゲーションと出力は明示した操作として表す。

## 9. 検証

- UI checker は raw palette、undefined token、arbitrary spacing、small hit target、motion、reduced-motion など決定可能な規則を検査する。
- component test は state matrix、keyboard、focus、accessible name、local error、pending 中の重複操作を実操作で固定する。
- 主要 flow は Playwright で、対応する最小幅、代表的なモバイル、タブレット、PC の主要状態を確認し、URL、request、保存、download、主要結果を主 oracle とする。意図しない横 scroll、safe area、focus 復帰、dialog / disclosure の位置変化も確認する。
- screenshot は補助とし、視覚レビューでは hierarchy、読み幅、関係的余白、product specificity、restraint、structural fit を確認する。初見点検と cognitive walkthrough で、目的、現在地、主要操作を説明できるか確認する。
- 各利用段階の代表画面は、3秒見た利用者が「いま見る対象」と「次の1操作」を説明できることを確認する。grayscale / blur でも主役が残ること、固定メンバーとプレー順が同じ色順を共有しても色なしで役割を区別できること、順位がどちらの sequence にも見えないこと、通常状態で信頼性の注意が出ないこと、同じ事実や内部都合を反復していないことも確認する。
- OCR 結果修正と手入力は、現行 baseline に対して画像と field の対応理解、修正完了時間、誤修正、操作数を比較し、同等以上であることを確認する。
- UI 変更の完了時は、対象要求、実行正本、checker、component test、必要な Playwright が同じ規則を検証していることを確認する。
