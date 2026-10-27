# Web UI / UX 規約

目的: momo-result の全画面で、同じ意味・状態・操作を一貫して表し、記録、確認、比較、出力を迷わず完了できるようにする。

本書は Web の横断的な意味表現、視覚階層、操作文法、安全性、状態表示、文言の正本である。業務用語・状態遷移は [ドメイン規約](domain-rule.md)、画面固有の目的・順序・指標は対象要求（例外は [画面固有の要求](#画面固有の要求)）、層・server state・motion・form の実装境界は [Web 実装規約](web-rule.md)、検証の選択基準と自動化境界は [テスト・品質規約の UI の検証を選ぶ基準](test-rule.md#ui-の検証を選ぶ基準)、アクセシビリティの最低水準（WCAG AA 相当）は [システム要求](requirements/system-design.md#9-performance--client-quality) を正本とする。component・class・token の現在名は実装を正本とし、本書は原則として役割で呼ぶ。主要な部品の役割と現在名の対応は [Web 実装規約の Implementation Entry Points](web-rule.md#implementation-entry-points) が入口として持ち、判断に具体名が必要な箇所は直接参照する。許容 scale と役割の対応は本書を正本とする。

規則が競合する場合は、正確性・データ保全・利用者の制御、アクセシビリティとタスク完遂、意味の一貫性、視覚上の洗練の順で判断する。統一感とは同じ意味が同じ原則で働くことであり、異なる文脈にはそれぞれに合う外形を使う。

## 製品の方向性と意味

- 主な利用場面は、4人の仲間が1試合ごとに OCR 取り込み、下書き確認、確定、次の対戦を繰り返し、開催分が揃った後に累積結果と傾向を囲んで振り返る時間である。この流れを分断せず、記録から雑談と仮説の発見までを支える。
- 製品は汎用ダッシュボードではなく、静かな対戦卓に置かれた、作り込まれた試合台帳として設計する。落ち着き、明瞭さ、精度を優先し、派手な演出、焦点の定まらない構成、AI Slop に見える定型意匠を避ける。
- この落ち着きは、実績画面で仲間が達成を楽しめる歓待のある表現や、根拠を監査記録のように事務的に見せない表現と両立する。楽しさの要求は実績の文脈に限る。根拠を保存・表示する契約と表示の正確さは [実績要求](requirements/player-achievements.md) のまま保つ。
- 注目対象は利用段階に合わせる。取り込み・確認中は現在の OCR 状態と次の修正または確定、確定後は累積結果、開催分が揃った後は結果を裏付ける比較と傾向を主役にする。異なる段階の主要情報には強弱の差をつける。画面ごとの主役の選び方は対象要求と [画面固有の要求](#画面固有の要求) に従う。
- 開催回、試合番号、OCR、下書き、確定、順位、結果、出力という業務語彙を使う。UI では対象、親スコープ、現在状態、実行可能な次の操作を判断できるようにする。
- UI に示す指標、件数、原因、信頼度、推薦は、利用者入力・保存済みデータを根拠とし、導出は要求で認めた範囲に限る。根拠のない値を UI 都合で補完しない。不明、未分類、計算不能、対象なしは、その状態を明示する。記録にないことの断定で、会話の材料を誤解や個人への能力断定に変えないためである。
- PC、タブレット、モバイルで配置が変わっても、情報、状態、操作、現在地、戻り先の意味を保つ。モバイルでも主要情報を保ち、再配置、必要な横スクロール、段階的開示、要約と詳細の対応で情報量を保つ。
- 構造、ラベル、境界、整列、accessible name で意味を伝える。主要操作と未知の操作は発見できる形で示し、必要な説明を添える。

## 現在地と視覚階層

- グローバルナビゲーションの現在地、必要な親スコープ、主要な検索・絞り込みを、初見でも判断できる位置へ置く。page 最上部の可視タイトルと補助文は、対象の identity 自体が主役になる試合結果・開催記録などの resource detail に限定する。一覧、入力 workspace、取り込み、比較、出力、設定・管理、認証では global navigation と content surface 内の section heading / landmark で scope を示し、route 名を page header として反復しない。詳細画面には所属する開催や一覧への明確な導線を持たせる。
- 画面の主役は利用段階で決める。未完了の取り込み、確認、編集では次に完了すべき操作を第一視線にし、確定済みの閲覧、結果、比較では判断対象となる結果を第一視線にする。結果と操作が共存する場合も強弱の差をつける。
- 初期表示範囲に画面全体の視覚的な錨を原則1つ定める。錨は見出しを飾る容器ではなく、現在の目的に対する主要結果、主要操作、または現在状態そのものとする。4人比較など同格の反復要素は一つの比較群として扱い、各要素を等しくしても、その外側へ同じ強さの錨を重ねない。
- 強調は次の3段階で組み立てる。
  1. **主焦点**: 位置、読み順、周囲の余白、文字の大きさまたはウェイトを優先する。主要操作の場合だけ高コントラストの塗りを使ってよい。
  2. **内容構造**: 見出し、整列、関係的余白、列でまとまりと順序を示し、それだけでは別の範囲と誤認する場合にだけ divider を補う。通常の section や説明を淡色面で囲わない。
  3. **局所標識**: 選択、現在状態、順位、分類、注意などを、短いラベル、marker、icon、compact な fill または border で走査可能にする。局所標識は対象の要素だけに付ける。
- 文字の大きさ、ウェイト、コントラストの3つすべてを同時に最大にするのは、画面の主焦点に限る。ラベルは値より、補足は本文より、metadata は判断材料より明確に弱める。色を除いた grayscale と blur でも主焦点、比較群、補助情報の順序が残ることを先に成立させる。
- 太字は、現在のタスクで読むべき主要結果、判断の核になる数値・短い文言、および見落とせない局所的な問題へ限定する。label、heading、button、link、selected、status、data value という種類だけでは太字にしない。内容構造は位置、文字サイズ、整列、関係的余白、操作・状態は既存の control、marker、文字、形で識別できるようにする。主要操作も塗りと配置を先に使い、補助操作を含めて通常ウェイトを既定とする。
- 強調の総量を相対評価する。同一のタスク範囲で最大強度の表現は1つとし、新しい強調を足す場合は既存要素のいずれを弱めるかも決める。同じ判断に使う同格の内容は一つの比較群として扱い、共通・個別などの適用範囲だけを理由に強弱を変えない。初期表示範囲の独立した大きな淡色面は1つまでとし、例外的に同格比較へ反復する場合は、反復群全体を一つの錨として読み取れる構造にする。
- 内容のまとまりは、利用者が答えを求める問いと作用する対象から決める。主情報、付随するメタ情報、内容を詳しく調べる操作、別候補への移動は、外形ではなく役割でまとめる。分類・件数・属性は対応する主情報の近くに置き、注意や解釈に必要な条件を含む場合は初期表示に含める。同じ説明を要約と詳細で反復する場合は、判断に必要な前提を残して説明の表示先を一つにする。
- 内容のない kicker、section 番号、大文字ラベル、同じ強さの KPI card や CTA を反復しない。重要性は、その要素が伝える結果、状態、操作を第一視線で読めることで示し、面積や装飾はその補助に使う。

## 色・面・境界

### 色と意味トークン

- 機能が使う色は、参照色、意味トークン、コンポーネント用途の順に参照したものに限る（参照外の色や一回限りの色値は直接指定しない）。操作色は選択、フォーカス、操作可能性の強調に限定する。
- 視覚基盤は light mode のみとする。白に近い canvas、無彩色から低彩度の neutral surface、十分な明度差を持つ text と border で端正に構成する。neutral の参照色は OKLCH の明度順に段階化し、canvas、surface、inset / selected、text、border、control、action の役割へ割り当てる。主要操作は高コントラストの dark neutral を基本とし、dark theme と theme switch は設けない。
- 4人を並べる基準色順は `1=青`、`2=赤`、`3=黄`、`4=緑` とする。固定メンバーを canonical 順に並べる表示ではこの順を member sequence として使い、各試合のプレー順を表す表示でも同じ順を play-order sequence として使う。共通する色順によって4人表示への馴染みを保つが、固定メンバー上の位置と試合ごとのプレー順は別の意味として扱う。固定メンバーの名前・canonical 順・適用先は [4人の共通結果台帳](#4人の共通結果台帳) に従う。
- member sequence と play-order sequence は同じ4色の参照 palette へ対応してよいが、意味トークン、formatter、label、component は分離する。固定メンバー主体の結果・比較・グラフでは member sequence、番手や画像内の並びが主体の入力・分析では play-order sequence を使う。同じ行、表、比較群でプレーヤーとプレー順を同時に示す場合は play-order sequence だけが4色アクセントを所有し、プレーヤー名は neutral にする。名前と `プレー順N` の文字、marker の形または配置も併用し、どちらの順かを色以外でも判断できるようにする。
- 順位は固定メンバー順やプレー順とは別の尺度であり、この4色順へ対応させない。rank は独立した意味トークンと `N位` の文字・形で示し、同じプレーヤーに付く member / play-order marker と区別できる表現にする。4色順の用途は2つの sequence に限り、member sequence は4人の固定メンバーを表す系列だけに使う（任意のグラフ系列、操作、状態、傾向、装飾には流用しない）。
- 操作、状態、順位、汎用グラフ系列、member sequence、play-order sequence は別の意味トークンを持つ。参照値の共有は上記2つの sequence 間だけに明示的に限定する。error、warning、success は sequence 色と明確に区別できる範囲で赤、黄、緑の色相を使ってよいが、ラベル、アイコン、形を併用し、sequence 色と同時に表示して取り違えがないことを検証する。区別できない組み合わせは neutral を基調にする。

### 淡色面・disclosure・標章

- 淡色背景は、選択中または現在の scope、状態・通知・注意、入力や操作の inset、および compact な装飾ラベルに限定する。通常の要約、説明、見出し、重要情報は、重要という理由だけで淡色面へ置かない。面を追加するのは「何の選択・状態・操作領域・局所標識か」を答えられる場合に限る。
- disclosure / collapsible は情報を開閉する操作であり、選択状態や inset とは別のものとして扱う。disclosure の展開 panel は自身の背景を持たず、周囲の面をそのまま使う（feature や filter からも panel 自体へ淡色背景を上書きしない）。実際の状態、注意、独立した操作領域を内包する場合だけ、その内側の該当要素へ淡色背景を付ける。enabled trigger は文字階層や用途 variant によらず同じ淡色 hover を持ち、行全体が操作可能であることを即時に返す。hover は enabled trigger の一時的な pointer feedback に限り、展開中の固定背景や panel の面とは分ける。
- `1位`、`2位`、分類名など、短く反復され、走査や識別を助けるラベルは局所的な標章として背景色、形、border を持ってよい。標章は文字だけでも意味が分かり、同じ種類で一貫した寸法と強度を持ち、clickable、selected、warning と区別できるようにする。装飾は標章の範囲に留め、badge は識別やリズムに寄与する場合に足す。

### 面と罫線の所有

- page canvas は、global navigation、関連画面への導線、detail で必要な画面見出しと content 間の余白を受け持つ。主要な作業・結果・data は白い content surface に置き、連続した1タスクまたは1 data scope につき原則1面とする。page 最上部の可視見出しを省く画面では、空になった header slot も省き、page-level action は作用する content surface の先頭または対象 section の近くへ置く。detail の画面見出しは原則として content surface の外に置き、面をまたぐ下線を既定で持たせない。
- table が主要内容の一覧・管理画面も、table は通常の内余白を持つ content surface の内側に置く。通常の data table は、親の surface と同じ背景、本文より弱い小さな header 文字、table 上端・header 下端・最終行下端の横罫線で構成する。本文行どうしの横罫線、外周の枠線、角丸、通常 header の淡色背景は付けず、pagination の有無にかかわらず共通 data table primitive、body row、header pattern を使う。sortable header の選択表現は操作部分だけが所有する。loading、empty、error、pagination は同じ data scope の面と余白に従属させる。内余白なしの variant は、workspace や全面表示など child が外余白を所有する明確な理由がある場合だけ使う。
- content surface の内側を通常 section ごとの白い card に分割しない。まず見出し、整列、列、関係的余白で構成し、同時に独立して扱う source / editor などの workspace、独立して反復する record、境界が操作の理解に必要な bounded panel に限って別面を許容する。empty、pagination、loading など親 scope に従属する状態・操作は、親の白面をそのまま使う。
- グルーピングは整列と余白から始める。divider は、隣接内容が余白と見出しだけでは同一群と誤認される場合、table の row / column、control、状態通知など境界自体が意味を持つ場合に限る。通常 section の divider は、必要な場合に片側1本とする。
- 1つの視覚境界は1つの owner だけが描く。親 surface の外周と先頭・末尾 child、disclosure の root と panel、table wrapper と隣接 toolbar などへ同じ境界を重ねず、隣接する平行線や二重線を作らない。要素の境界は、淡色背景、border、角丸のうち伝えるために必要な最小の手段で表す。
- sibling 間の divider は、それらを並べる親 composition が divide utility または独立した separator として所有し、各 child の先頭・末尾 border と先頭・末尾の相殺で組み立てない。control、bounded panel、badge、table の上端・header 下端・最終行下端など、部品自身の意味を成立させる perimeter / internal boundary はその部品が所有する。装飾だけの separator は accessibility tree へ意味を追加せず、内容上の区切りを表す場合だけ semantic な `hr` または section 構造を使う。
- 通常の入力・選択欄は、既存の薄い select 枠と同じ参照色を持つ共通の補助境界 token を使う。控えめな全周枠で統一する採用方針であり、通常枠の 3:1 以上は保証しない。半透明の枠は入力背景と外側の面を含めて見た目を確認し、無効状態を通常状態と同じ濃さへ強制しない。
- テキスト・数値・日時 input、textarea、一行 select、値と変更 button を持つ dialog 型選択欄、選択肢 group の外枠は同じ通常境界へ接続する。矢印や picker icon の有無、候補が popup か dialog かによらず、枠の濃さは同じにする。候補がなく変更できない選択値の表示も、同じ field の枠を保つ。
- 通常・invalid の境界 recipe と control の tone 優先順位は shared UI の共通 control presentation が所有する。複合 field は境界 recipe を使い、入力そのものの hover や padding の適用先は入力要素に限る。feature は shared の境界 recipe の枠色を使う。
- 独自選択マーク、select の矢印、focus、要確認・error の意味枠は通常の補助枠から分け、実際の隣接色に対して 3:1 以上を確保する。これらの識別標識は通常枠の薄色化と独立させ、focus 移動の後も選択・error・説明を保つ。
- 枠付きの副 button / icon action は専用の補助境界 token を使い、通常の入力・選択欄と薄い参照色を共有する。主操作は塗りで区別する。quiet や開閉操作へ常時の枠を追加せず、一般の区切り線の色を一括変更しない。
- shadow は dialog、tooltip、toast など浮遊 UI に限定する。通常内容に elevation を足さず、gradient、glow、大きな surface contrast を装飾に使わない。
- 角丸は参照値の共有だけでなく、要素の役割と包含階層を表す。`xs` は compact な badge、marker、data cell、`sm` は control と小型の bounded panel、`md` は record、card、notice など content 内の独立境界、`lg` は page-level content surface と dialog、toast など最上位または浮遊する面に使う。`full` は円、pill、progress track など輪郭自体に意味がある形へ限定する。table は外周角丸を持たない。
- 外側と内側の輪郭が同時に見える入れ子では、内側を外側より少なくとも一段弱い角丸にする。同じ角丸を重ねる前に内側の面、border、角丸のいずれかを除けないか確認する。画像を面の端まで裁つ場合は親の角丸と `overflow-hidden` を共有し、inset する場合は内側の役割に応じて弱める。外側と内側の半径比を固定式や source checker にせず、実際の padding と paint を含む visual review で同心性と階層を確認する。

## 文字・余白・レイアウト

### 文字

- 一次情報、補助情報、ラベル、placeholder、disabled を既存の文字トークンとウェイトで階層化する。見出し、本文、ラベル、データの役割を固定し、本文と control は regular 以上を使う。可視文字は `12px` を下限とし、通常本文、操作、主要データは原則 `14px` 以上、`12px` はラベルと補助 metadata に限定する。chart axis も、別の数値表現がある場合を含めて同じ下限を保つ。主要結果、操作、エラーは、十分な文字サイズ、ウェイト、コントラストで示す。
- 文字サイズは `12 / 14 / 16 / 18 / 20 / 24 / 30px` の共通 scale から選ぶ。役割はサイズ差だけで増やさず、同じ役割は共通文字 recipe、ウェイト、文字色、行高を再利用する。狭い component に収まらない場合も文字は scale 内に保ち、component 幅、情報量、折り返し、局所 scroll、段階的開示の順に見直す。
- 濃色の本文が主要な結論と競合する場合は、`text-primary` を主要な結論・結果や識別の要点、`text-body` を通常本文、`text-secondary` を補足へ割り当てる。本文との濃淡差が足りない補助ラベル・補足には `text-muted` を使ってよいが、実際の背景とのコントラストと小さい文字の読みやすさを確認する。文字色の変更は役割が確かめられた箇所に限って適用し、主要結果や注意表示の強さを保つ。
- 文字ウェイトは次の役割へ割り当て、具体的な token と utility は global stylesheet が所有する。通常表示を既定とする。

  | 役割 | ウェイト | 用途 |
  | --- | --- | --- |
  | 通常表示 | 400 | 本文、通常の値・入力値、form label、表の列・行見出し、補足、操作、navigation、tab、状態・順位の標識 |
  | 内容構造 | 500 | section・dialog の見出しなど、まとまりを示す短い文字。サイズと余白でも見出しを識別できること |
  | 主要強調 | 600 | 主要な順位・金額・比較結果、判断の核となる短い文言、対応が必要な問題の要点 |

- 端末フォントによって 500 は 400 と同じ face、600 は Bold の face へ対応し得る。見出しは 500 以外の手掛かりでも識別できるようにし、600 は太字として扱う。ウェイトは表の3段階に限り、英数字と日本語の描き分けが揃わない環境でも意味を保つ。
- 文章を中心に読む内容と記録情報では、次の文字 recipe を基本とし、具体的な class の組み合わせは共通文字 recipe が所有する。主要情報・通常内容・補足の3つのサイズで階層を作り、内容構造は通常本文と同じサイズでも位置とウェイトで識別する。HTML の heading level は文書構造に従い、この文字役割とは別に選ぶ。

  | 内容の役割 | サイズ / 行高 | ウェイト | 文字色 |
  | --- | --- | --- | --- |
  | 主要な結論・短い主情報 | 20 / 28px | 600 | `text-primary` |
  | 一覧・反復行の主要結果 | 14 / 20px | 600 | `text-primary` |
  | 内容構造・小見出し | 14 / 20px | 500 | `text-primary` |
  | 通常本文・値 | 14 / 20px | 400 | `text-body` |
  | 補足・メタ情報・ラベル | 12 / 16px | 400 | `text-muted` |

- 一覧や反復する結果行は、走査密度を保つ一覧用の主要結果 recipe を主要結果へ使う。単独で読む結論の recipe と重要度は同じでも、配置密度に応じたサイズは feature ではなく共通 recipe で選ぶ。
- 上表は全画面の文字を 20 / 14 / 12px へ置換する規則ではない。主要金額、表、chart、control、長文の読み物は用途に応じた既存の共通 recipe と許容 scale を使う。同じ役割のサイズ、行高、ウェイト、色は共通 recipe に従い、複数の実用途で別の組み合わせが必要なら共通 recipe 側で定義する。element の既定スタイルは base layer に置き、明示された recipe を優先させる。
- 同格の4人比較や反復する試合結果では、同じ主要指標を比較群として等しく強調してよい。その場合も太字の一括適用は避け、主情報でない名前、補助指標、説明、操作はそれぞれの役割に応じたウェイトを使う。試合結果のように「だれが何位か」を読む場面では、名前と順位も主情報として扱う。太字を減らした分を、濃い背景、大きな文字、余白の拡大で一律に補わない。

### 余白

- 余白は基本 scale `4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64px` から選び、距離が表す関係を先に決める。page frame 直下、および一つの content surface 内で page scope を分ける主要 block は原則 `24px`、section または form の主要 sibling と同格の compact な card / record 間は `16px` とする。文章中心の内容では、関係の近い項目同士を `8px`、主情報・具体的内容・補助操作など問いの異なる群を `24px` で区切る。長い detail / analysis 内で見出しと scope が独立した最上位 section 同士に限り `32px` を許容し、通常の section や form の中間段階には使わない。
- 複数の意味上の内容群または field 群を持つ独立 card / record の内余白は `16px`、一つの状態・値・操作を示す compact な bounded panel と走査密度を優先する data record の内余白は `12px` とする。一つの操作または状態を完結させる compact component 内では、`4 / 8px` では群境界が不足し `16px` では走査密度を損なう content cluster 間に限り `12px` を使ってよい。page-level content surface の default は狭い viewport で `16px`、`sm` 以上で `24px` を共通 primitive が所有し、理由を持って密度を保つ compact variant は viewport にかかわらず `16px` とする。
- 独立した action 間と通常の inline item 間は原則 `8px`、compound control 内および一つの値・標識内で密接な要素間と、support text 同士および control から support text は `4px` とする。同じ対象を調べる quiet な補助操作を縦に並べる場合は、hit target 内の余白で文字が離れていれば外側の gap を重ねなくてよい。基本 scale 外の `2px` は一つの label / value 内の密接な文字関係と光学補正だけに使ってよい。`1px` は border、divider、underline の境界補正に限定する。`20px` は大型 control の内余白など component 内部、`48 / 64px` は原則として独立した empty / error など page-level 状態の外余白に使う。複数の内容群や可変長のメモを持つ detail 内の反復 record では、罫線を使わず読む単位を分けるために record 間の `48px` を許容する。通常の page や section の中間段階を増やすためには使わない。寸法、最小 hit target、scroll geometry は余白 scale と別に扱う。
- 同じ grouping の包含階層では、外側の群ほど内側の群より同じか大きい余白を持たせる。長い detail / analysis の最上位 section 間隔はこの比較対象から除く。data table、chart、matrix、compact badge は走査と比較に必要な密度を優先し、その外側の section 間隔で呼吸を作る。狭幅の page gutter は `12px` を許容し、navigation の scroll bleed も同じ owner に従わせる。
- sibling 間の余白は親 composition が自身の gap / space または自身が生成する slot wrapper で、component の内余白はその component、page gutter と page sibling 間隔は page layout primitive が所有する。再利用 child の API に外 margin を持たせて親の余白と二重化せず、loading、error、empty、ready の状態置換でも同じ owner と間隔を保つ。field は label から control を `8px`、control から description / error と support 同士を `4px` で関係付け、dialog は header、body、feedback、footer を別の群として構成する。safe area は fixed layer の viewport が左右両方を含めて所有し、child padding を画面端の位置補正に流用しない。

### レイアウトと状態の骨格

- 初回 route loading、route-level error / access terminal、feature loading は、pathname と安全化済み query から確定する page width、専用 shell、戻る導線、detail で必要な header、content surface 内の常設 action / status、文脈 slot を ready と同じ順序で保持する。ここで常設 action とは、pathname / query だけで移動先まで確定する navigation action を指す。runtime callback や data 取得結果で初めて実行可否・移動先が決まる action / notice は推測して skeleton や terminal action を足さず、loading は確定済み slot の大きさと responsive な積み替え、terminal は確定済み chrome と回復操作を保つ。ready で page header を持たない route の loading / terminal だけに title skeleton、eyebrow、description または空の header slot を作らない。状態ごとの余白と route 判定は、同じ layout primitive、親 composition、route presentation を owner にする。状態の切替で作業領域や現在地が作り直され、layout が跳ねることを防ぐ。
- page、data surface、workspace は一貫した外余白の内側で利用可能な横幅を使い、読み幅の制約は prose、単一 field 群など幅を狭める理由がある内容へ局所的に掛ける。長文になり得る page description、help、error、notice、empty state、narrative は、親の面を狭めず文字内容を共通の readable measure 以内へ制限する。短い label、metadata、table、chart、matrix、横比較にはこの measure を一律適用しない。画面全体を文章幅へ縮めず、試合間・プレーヤー間の走査や比較が速くなる表・図表は一貫して密にする。不規則な欠け、根拠のない非対称、任意の値や z-index を追加しない。
- 縦 scroll が不要な page では、viewport の右端に scrollbar 用の空きを常時予約せず、global navigation と page が利用可能な幅を使う。必要な scrollbar はブラウザに任せ、dialog / select の scroll lock と幅補正は共通 primitive に任せる。
- page 幅は内容形状に応じた少数の共通 variant に収束させる。単一の短い form / prose は readable measure の narrow、通常の一覧・管理・取り込みは standard、横比較・詳細分析は wide、source と editor を常時並置する編集 workspace だけは workspace を使う。同等の画面は同じ variant を使い、内部の短い prose や単一 field だけを局所的に狭める。
- 再利用部品の内部配置は intrinsic な折り返し、必要なら名前付き container query で割当幅に応じて切り替える。inline-size containment は親が幅を与える境界に置き、内容から幅が決まる badge・status まで一律に適用しない。page 全体の横 scroll は作らず、table、図表、source image など横方向の関係を保つ必要がある領域だけが、可視の案内とともに局所 scroll を所有してよい。
- ID、URL、外部 error など切れ目のない長い値だけへ局所的な wrap または scroll を指定し、全画面へ `overflow-wrap: anywhere` を継承させない。見出しの balance や本文の pretty wrap も、data label、定義値、control label を含め役割ごとに指定する。
- 一行として走査する control、status、action cluster、通常の table cell は中央、文字同士の短い label / value 行は baseline、heading と lead や主情報と metadata からなる可変高の複合 record は上端を揃える。field を横に並べる form row は control の下端を揃えてよい。table editor の上端、chart axis の下端など対応関係のための例外は局所的に明示し、画面ごとの任意な offset で調整しない。shared interactive primitive が文字サイズ、行高、responsive な高さを所有し、global element selector の font shorthand で上書きしない。

### データ表現

- 日時、金額、試合番号、状態名は共通 formatter / ViewModel を使う。件数と比較値には対象、単位、分母または基準を添え、整列する数値には tabular numerals を使う。
- 時系列の連続 timeline は順序付きリストと1列の marker 軸で構成し、connector は隣接する marker の中心間だけを結ぶ。軸を最初の marker より上、最後の marker より下へ伸ばさず、record の枠線や別の縦罫線を平行に重ねない。各 marker は順序を文字でも示し、record heading と対応させる。一つの record に識別情報、結果、メモなど複数の内容群がある場合は、群内より record 間の境界を明確にする。群内は近接させ、record 間にはそれより大きな余白を取り、メモの展開後も次の record の開始位置を追えるようにする。横罫線は余白だけでは境界が読み取れない場合に補助として使う。
- page 最上部の可視タイトルを省略する画面は、主要 content surface に用途を表す `aria-label` と適切な landmark を与え、surface 内の可視 section heading と control label は保つ。状態通知の title は page title の代用ではなく、発生した状態と回復方法を伝える局所 heading として保持してよい。
- 同格の disclosure を列で並べる場合、同じ行の別 trigger や操作は一つの展開の前後で位置を保つ。各列は自身の内容順を保ち、展開による高さ変化は当該列と後続の共通内容だけへ反映する。

## 操作文法とコンポーネント境界

操作文法は、利用者の目的を一貫した操作と結果へ対応させるための横断契約である。共通化は外形や event handler の類似ではなく、目的、対象、作用、開始前と完了後の状態、制約、feedback、失敗時の回復が同じかで判断する。同じなら画面が異なっても同じ shared UI primitive または操作 pattern を使い、業務上の結果や制約が異なる場合は外形が似ていても別の操作として扱う。

### 抽象化の単位と所有権

- shared UI は、意味に対応する構造、keyboard / focus、accessible name、hit target、disabled / pending、局所 feedback、component 内部の responsive arrangement を所有する。feature は業務語彙、URL / query / cache、権限、入力変換、副作用、業務状態遷移を所有し、app は route と画面 composition、shared domain は横断する業務 identity、順序、formatter を所有する。UI でも責務分離で統率を保ち、共通部品が業務判断を抱え込まないための分担である。
- shared UI へ切り出すのは、複数の現在用途を一つの小さい契約で覆える場合、または単独用途でも accessibility、制約、feedback、状態同期の重要な判断を隠せる場合に限る。名前を付けただけの wrapper、呼び出し元の判断を props へ移すだけの万能 component、将来用途だけを見込んだ schema は作らない。
- primitive、操作 pattern、feature composition の三層で考える。feature は shared UI を組み合わせて文脈固有の操作を作り、shared UI は feature の業務 enum、API DTO、query key、文言一覧を知らない。
- 複数画面で共有する業務 UI は業務別の shared module に置き、汎用部品へ接続する。共有されることと業務非依存であることを区別する。分析チャートのメンバー対応・分析用語は分析 feature が所有し、汎用部品にするためだけの設定 props や転送 wrapper を増やさない。依存方向と配置は [Web 実装規約の Layering](web-rule.md#layering) を参照する。
- component を置く親 composition は、grid / flex 内の位置、並び順、外側の幅・高さ・余白、sibling 間の gap / divider、画面幅に応じた伸縮と積み替えを所有する。再利用 component は、内容または親が定めた slot に従って縮小・伸長できることを既定とし、特定の利用箇所だけを理由に autonomous な固定幅、固定高、外 margin、隣接 separator を持たない。page frame、dialog viewport、局所 scroll viewport など、利用可能領域を定義すること自体が責務の layout primitive はこの限りではない。
- shared UI は、keyboard / focus と一体の最小 hit target、control の内部 padding / line-height、icon・marker の寸法、画像・図表で意味を保つ aspect ratio、内部 content scroller など、部品の契約を壊さない intrinsic constraint を所有する。全幅・全高の指定は親が定めた slot を消費する指定として使ってよいが、それだけで親の寸法責務を部品へ戻したとは扱わない。consumer は原則として外側 container で寸法を指定し、intrinsic constraint と internal boundary を保つ。
- 汎用部品は通常表示を既定とし、主要コンテンツであることが契約に含まれる部品だけが、該当する値・短い文言へ主要強調を持つ。feature composition は画面の主役を選び、同じ文字 recipe をその箇所へ適用する。任意のウェイトを渡す万能 API や親全体の太字指定で補正しない。`th` / `scope` / heading level などの意味構造とウェイトを分離し、子の label・metadata・操作へ太字を継承させない。
- label と値を読む表示は、共通の label / value 表示 pattern が term / definition の意味構造、文字 recipe、label と値の近さ、項目間隔、列数に応じた積み替えを所有する。通常の文章・記録情報には周囲の面を共有する plain 表示を使い、feature は項目の内容と並びを渡す。入力 field は label と control の対応を持つ別契約とする。
- 通常の表は共通 data table primitive が caption、列見出し、行見出し、overflow の検出と案内を所有する。実際に scroll が必要な場合だけ keyboard の到達点を加え、caption または用途名で scroll 領域を識別する。feature は行の identity、業務 cell、並び順を渡す。
- 軸やセル構造が異なる行列も、native table と共有 table scroll area の組合せで同じ scroll 契約を使う。SVG 図表は保存済みの数値・系列名を読み取れる代替表を持ち、多数の観測点すべてを Tab 順に入れない。行の移動先が多い場合は、数値表のページ送りで到達可能な操作数を制限する。
- 見出しと本文・値・説明からなる読み取り群へ、編集・移動・保存などの補助操作群を横に添える場合は、内容群と操作群を並べる共通 pattern を使う。見出しとその本文・値・説明は内容群にまとめ、操作の高さで文字同士の距離を増やさない。横方向の群間は `16px`、折り返した操作との間隔は `8px` とし、部品へ割り当てられた幅に収まらなければ内容、操作の読み順で積み替える。画面幅だけで横並びを強制せず、負の余白や重ね配置で hit target を本文へはみ出させない。内容内部の文字階層と間隔、見出し・region・操作名の意味は feature が所有する。page header、label と入力欄、tab、disclosure、dialog の固定 header と閉じる操作は、この pattern ではなく各 primitive の操作・scroll 契約を使う。

### 選択・表示切替・表示範囲

- 説明を読み比べて一つを選ぶ候補は、native radio group と説明付きの選択行で表す。群の名前は可視 legend、または `aria-labelledby` で参照する可視見出しが所有する。単一の選択群だけを扱う dialog では「開催を選択」等の title を群の名前にも使い、「開催候補」等の同義見出しを重ねない。独立した複数の群を持つ場合は、それぞれの legend を残す。選択行全体を操作可能にし、選択状態は control、文字、形でも識別できるようにする。候補固有の別操作は選択 label の外に置く。
- 開催、試合など日時・件数・状態を読み比べる単一選択は、現在値と変更 trigger を持つ共通 dialog field を使う。任意選択の「すべて」「選択しない」も同じ radio group の候補として扱い、filter、OCR、作成・編集、出力のどの文脈でも同じ選択文法を使う。候補が1画面に収まらない場合は共通の compact pagination で server page を切り替え、page 外へ移った現在の選択と表示 label も保つ。
- 選択 dialog は title、選択肢、必要なページ送りの順に構成する。必須／任意など field の注記は title へ反復しない。読み取りの更新表示は title の名前を保ったまま、閉じる操作と同じ header 内の安定した slot へ置く。待機表示だけの空行を一覧の上へ加えず、header・body の左端を揃え、本文の scroll 用の内余白を見出しからの意図しない段差にしない。
- 少数の短い mode 選択のうち、値だけを変えて周囲の内容領域を切り替えないものは segmented control を使う。同じ対象の view を切り替える場合、または選択ごとに直下の候補・結果・実行内容が一つの対応 panel として切り替わる場合は tab を使う。補助詳細の開閉は disclosure、多数の簡潔な候補は select または検索可能な選択を使う。部品は見た目ではなく意味で選び、選択と即時実行を区別する。
- page-local な主要 tab は、設定管理を基準とする共通の filled presentation を使う。tab list 自体を枠や背景で囲わず、選択中の tab だけを selected surface、文字、`aria-selected` で示し、狭い幅では label を分断せず tab 単位で折り返す。同じ panel 内の下位 view は、より弱い underline presentation と局所的な横 scroll を使ってよく、上下2階層を同じ強さの fill で競合させない。
- tab は同じ tab set として tab list、tab、対応する tab panel の関係を持ち、keyboard focus と選択状態を shared UI が所有する。focus 移動だけで即座に表示できる panel は自動 activation を使ってよいが、取得や高コスト処理を始める切替は、矢印キーで focus、Enter または Space で activation する。切替後の取得中も起点 tab の DOM と focus を維持し、stale content の `inert` 化で focus が document へ退避した場合は完了時に起点へ戻す。ただし、利用者が別の操作へ移した focus は奪わない。panel を伴わない排他条件は tab の外観へ寄せるために tab semantics を付けない。
- filter は表示対象の scope を変える操作であり、変更先の data surface の近くへ置く。主要条件、必要な場合だけ開く詳細条件、結果または件数、scope を示す一つの全解除を一つの操作群として対応させる。この「操作群」は意味と配置のまとまりであり、全体を card や淡色面で囲うことを要求しない。閉じると見えなくなる詳細条件は、非既定値だけを disclosure trigger の補助タイトルへ具体的に要約し、開閉中も同じ現在値を保つ。常時見えている主要条件や sort は各 control を表示上の owner とし、別置きの `適用中` 欄へ再掲しない。
- 一覧では data surface を主役とし、filter は同じ content surface 内でそれを支える階層に置く。条件内では高頻度の主要条件、sort、必要時だけ開く詳細条件、件数の順に強弱を付ける。少数で短く、高頻度に切り替える filter は直接選択を使ってよいが、多数または階層的な排他候補は select など一つの共通 control にまとめる。親状態と下位状態を同じ値に対する二重の選択状態として並べない。既定値や可視 control と同じ内容を要約で再び強調せず、詳細条件の要約は閉じた状態で現在値を確認するために必要な強さへ留める。
- filter の件数は取得できた範囲だけを事実として表示する。取得失敗や未取得は `0件` ではなく件数不明として示し、表示対象への影響と再取得操作を filter 群の近くに置く。
- 同一 scope の総件数を表示する場合は、filter 要約、一覧 toolbar、pagination などのうち一か所にまとめる。範囲と総数を同時に判断する一覧では pagination を表示上の owner とし、filter 内訳など別の判断に必要な件数だけを別途示す。
- filter の見た目と操作契約は横断化してよいが、URL、query、cache、cursor、候補間の依存、既定値、更新文言は feature が所有する。横断 component に filter schema や query 実装を持たせない。
- 取得済み内容を保持したまま filter、sort、page を変える場合の表示は [取得状態とフィードバック](#取得状態とフィードバック) に従う。描画を遅延する場合も表示中の内容と見出し・対象を一致させ、待機は共通の pending / stale 表示へ接続する。単なる描画の追従に専用のアニメーション、固定待機時間、成功通知を加えない。

### 移動・実行・確定

- shared action link は app 内の routing と document の移動を別の prop で区別する。disabled / pending の切替では実要素、ref、説明、focus を保ったまま、activation を制限する。開始した native navigation を pending 表示への切替で取り消さない。
- 取り込み・手入力・OCR 確認の最終実行領域は、共通の task action panel presentation で枠なしの淡色背景と `16px` の内余白を持つ操作領域に揃え、可否・結果の feedback と実行操作を一群にする。dialog 内の確定操作は一貫した footer、読み順、主要度を持ち、pending 中の不用意な閉鎖を防ぎ、結果を確認できる状態を保つ。

### 更新・再試行・初期化・破棄

- 更新は、現在有効な表示条件のまま data を再取得する操作である。`ready → updating with stale content → ready` を基本とし、失敗しても取得済み内容を残して更新失敗を局所表示する。
- data の更新は利用者が更新 / 再試行を実行したときだけ開始する（一定間隔、遅延 timer、別 tab からの復帰、window focus、network reconnect は起点にしない）。更新の起点を利用者の操作と明示した限定例外に絞り、表示中の内容や作業が変わる時点を利用者が予期できるようにする。更新操作と区別する自動取得の条件は [Web 実装規約の Server State](web-rule.md#server-state) に従う。
- 再試行は、失敗した同じ操作を同じ入力と scope でやり直す回復操作である。`error → pending → success | error` を失敗箇所の近くで示し、入力、選択、scroll 位置を保つ。route retry は query と error boundary を同時に reset する。
- 初期化は、利用者が変更できる値を明示された既定値へ戻す操作である。`customized → defaults` の対象 scope をラベルで示し、主要操作にするのは変更がある場合に限る。初期化に伴う再取得は更新 feedback を併用するが、再試行や破棄とは呼ばない。
- 破棄は、未確定または一時的な変更を取り除き、`dirty → clean` へ戻す操作である。失われる内容を先に示し、影響が大きい場合だけ確認を挟む。保存済み data の削除と未保存変更の破棄は別の文言で表す。
- 更新、再試行、初期化、破棄は、icon、文言、loading 表示の組合せで各操作の意味を識別できるようにする。共通化する場合も、各状態遷移と回復契約を保つ composition に留める。

### 状態・制約・feedback

- 非同期 button は通常時と pending 時の文言・icon の領域を確保し、同じ viewport では切替の前後で幅・高さと隣接操作の位置を保つ。文言の切替を残し、狭幅での折り返しにも対応する。寸法確保用の内容を重複して読み上げず、button 本体と form / focus の lifecycle を保つ。
- 業務状態の表示は、補助 metadata や color からの推測ではなく、明示された状態を表示用の共通表現へ変換して行う。業務状態の enum や遷移自体は feature / domain が所有する。完了・失敗の通知先は [取得状態とフィードバック](#取得状態とフィードバック) の表に従う。

## 入力・ワークスペース・アクセシビリティ

- 一行ラベルの単一選択は shared の一行 Select primitive を使い、keyboard・focus・候補表示は primitive に任せる。
- 一行 Select は、候補移動と値確定を分ける。現在値は check と selected surface、操作位置は focus で示し、hover は共通の反応の文法へ接続する。Enter / Space で確定し、Escape・外側押下・Tab では未確定の候補を採用しない。Escape は欄へ戻り、Tab は次の操作へ進む。閉じた欄の typeahead による値確定は維持し、同じ値の再選択で業務処理を増やさない。
- radio と segmented control の候補の名前は対象を識別する安定した label とし、件数・状態・補足は description、選択状態は checked として関連付ける。同じ説明を名前にも繰り返さない。
- Select の可視 trigger が label・説明・error・外部 ref の接続先となり、フォーム送信と reset は shared が所有する。空文字の意味と候補更新時の値変更は feature が所有する。popup は既存の寸法・面・境界を使い、viewport 内の一つの候補 scroller へ収める。dialog 内の候補は owning dialog の focus と layer に所属し、本文で切れたり、親 dialog の退出後も操作可能なまま残ったりしない。
- 試合入力表の選択欄も Enter / Space / 上下を選択操作に使う。閉じた選択欄では Tab・左右で欄を移動し、開いた候補の操作を表の移動へ渡さない。数値入力のセル移動・編集取消はその入力契約を維持する。
- 入力用の文字は共通の入力文字 recipe を field / fieldset primitive と独自入力欄で共有する。可視ラベルは 14 / 20px・通常ウェイトの主要文字色、補足は 12 / 16px、修正に必要なエラーは 14 / 20px・danger とし、読むための小さな metadata ラベルを入力ラベルやエラーへ流用しない。control 自体の入力値・高さ・focus 表示は既存の interactive primitive が所有する。
- 入力中の現在対象（撮影先、確認中の項目、参照画像）と、確定前に照合する主要結果を識別の要点として強調する。設定の確認値は編集 control と区別し、通常の label / value として共通の label / value 表示 pattern で示す。確認 dialog では設定、結果・送信対象、注意、確定操作を意味ごとの群に分け、長い名称は確認前に全文を読めるようにする。
- OCR 結果修正と手入力は、入力 field と対応する source image、同じプレーヤー・項目順、編集結果の feedback を一つの workspace として保つ。この対応関係と少ない修正手数を保護し、画面の分断や画像と field の往復を増やさない。
- coarse pointer の操作は viewport 幅にかかわらず 44px 以上の interactive box を持ち、compact 化は `pointer: fine` が明示された場合だけ許容する。44px は painted icon、thumb、track 自体の寸法ではなく hit target の寸法であり、視覚要素はその内側で役割に合う大きさを保ってよい。icon-only action は pointer accuracy にかかわらず 44px 以上を保つ。
- 隠した native input の focus を可視 label へ描く場合、同じ対象に二重の枠を描かない。候補一覧等の切り抜き境界に接する操作は、共有部品が内側の outline を所有し、feature の余白補正で切れを隠さない。forced colors でも選択の印と focus 枠を残す。
- dialog の縦 scroll は、見出しと閉じる操作を固定した一つの内部 content scroller だけが所有する。極端に低い viewport や拡大表示で固定領域だけが利用可能高を超える場合は、すべての操作へ到達できるよう dialog surface 全体を唯一の scroller に切り替える。内部 disclosure の展開も有効な唯一の scroller の高さへ収まり、背後の page scroll を動かさない。全幅 control の focus ring が scroller 境界で切れないよう、共通 content scroller が outline 分の inline gutter を持ち、個別 form で補正を重ねない。
- camera preview、source image、分類 tray など同じ画像を対応付ける frame は、状態や配置の前後で aspect ratio を保つ。OCR の撮影 preview と分類 tray は `16:9` を保ち、画像全体を確認できる収め方を使う。

## UI ライティングと分析の断定

- 文体は普通の Web アプリとして、短く、具体的に、落ち着いて書く。親しさを演出する冗談や過剰な励ましは足さない。これは実績画面で達成を楽しめる表現にすること（[製品の方向性と意味](#製品の方向性と意味)）と両立する。要求正本で定義された `桃鉄型`、`遊戯王型` など仲間内の語彙はそのまま使う。
- 一つの文言は、対象、現在状態、結果、影響、次の操作、判断に必要な根拠のいずれかを伝える。同じ事実は heading、lead、notice、button 周辺のうち、正本となるラベルまたは表示の1か所で伝える。条件付きの注意は条件が成立した箇所だけに出す。
- `カード表示`、`一覧表示`、`この欄` など容器や表示形式を説明する語は、利用者の判断を変える場合に限って表示する。期間と対象を section heading に統合できる場合は `直近8戦と荒れ方` のように内容を直接名付け、同じ範囲を別の fact や lead で復唱しない。
- ラベルと値の組は、値が対象を特定する、判断を変える、または次の行動を具体化する場合だけ置く。値がラベルや隣接構造から自明な言い換えにしかならない組は削除する。たとえば `使う場面: 発動条件に当てはまるとき` のような自己参照的説明を置かず、実際の発動条件をその項目で直接示す。
- 視覚的な強さは情報価値に対応させる。内容が新しい事実、判断、状態、操作を増やさない説明を、背景、見出し、太字、独立 section で目立たせない。期間、対象範囲、単位など解釈を変える前提は一度だけ明示する。
- 曖昧な構造、不正確な値、欠けた状態、発見しにくい操作は、説明文ではなく構造、コンポーネント、data contract、状態表現を直して解消し、それでも判断に必要な説明だけを残す。
- section 番号への参照、他の表示との重複回避、候補の選別など、生成・編集の内部都合を利用者向け説明にしない。省略や選別が解釈を変える場合だけ、その結果と範囲を対象の近くへ示す。
- 分析文の強さを `事実 → 傾向 → 仮説 → 提案` の順に区別し、要求正本と根拠が許す段階までに留める。仮説は次の対戦で確かめる対象として示し、提案は要求で明示された場合だけ、根拠とともに示す。
- 分析は「分かったこと → 根拠となる試合・件数 → 実戦上の意味 → 必要な場合だけ手法」の順で示し、数学知識を前提にしない。定義済みの判定と根拠がある事実または傾向は会話に近い heading にできるが、観測していない原因や推薦へ広げない。手法名は主要ラベルにせず、必要なら二次 disclosure で平易な説明と対応させる。
- 信頼性は例外として扱う。OCR 品質、data 欠損、分析上の不確かさを別の原因として正本から受け取り、解釈を実質的に変える場合だけ影響範囲とともに警告する。`参考値`、`信頼度低め`、`対象なし` を混同せず、UI が metadata 欠落から健全性を推測しない。通常または十分な状態の安心文言は出さない。
- 見出し、ラベル、button、badge は名詞句または短い操作句として句点を付けず、説明、影響、回復方法を述べる完全文は句点で閉じる。件数は対象と単位を空白で分断せず、全体との比は `未確認3件／全8件` のように対象、単位、分母を明示する。
- 保存済み data を取り除く操作は「削除」、未保存または一時的な入力・画像を取り除く操作は「破棄」、変更可能な条件を既定値へ戻す操作は「初期条件へ戻す」と表す。利用者向け文言と accessible name には component 名、design token、内部 field、worker など実装上の呼称を使わない。

## 取得状態・フィードバック・モーション

### 取得状態とフィードバック

- 取得状態は、表示対象の意味上の同一性に基づいて「置き換える」か「維持する」かを決める。初回表示、または異なる pathname へ移動して新しい内容が未準備の場合は、最終 layout に近い structural skeleton を使う。
- 同一 pathname 内の filter、scope、sort、page の変更と refetch では、既存内容を保って局所的に更新中を示す。同じ条件の再取得では通常の濃さと鮮明さを保ち、内容に待機表示を重ねない。表示中の内容が新しい条件では誤操作を招く場合は、必要な範囲を操作不能にし、条件変更を操作の近くで示す。減光・ぼかしは、操作制限が必要な範囲に限る。表示中の scope と要求中の scope を区別して知らせ、見た目だけを残して支援技術から無条件に隠すことを「保持」としない。
- 結果取得中も安全に変更できる条件欄は、操作可能なまま focus を保つ。古い結果への操作制限とは分け、連続変更には最後の条件を反映する。利用者が次の操作へ移した focus を、取得完了時に戻さない。
- loading の通知単位は、一つの利用者操作と、その結果を成立させる取得のまとまりとする。API、query key、component、Suspense boundary の数では決めない。一覧と件数の同時更新、保存に付随する cache 整合は、同じ操作の待機としてまとめる。独立して開始・回復できる別の操作は、それぞれの進行と失敗を判断できるようにする。
- 一つの待機には、その時点で因果の近い表示を一つ置く。再試行では失敗箇所の操作、実行中の操作がある場合はその button、操作を伴わない取得では対象領域の status を使い、親子の spinner、overlay、toast を重ねない。button 内の spinner と文言は一つの表示としてよい。対象を識別する静的な状態ラベルと、安全のための disabled は保ち、待機表示は上記の一つに限る。
- 操作欄の待機表示には通常時から領域を確保し、出現・消失だけで操作欄の折り返しや内容の上端を動かさない。取得済み内容がある再試行では、処理開始後も失敗案内と再試行操作を保ち、その場で pending を示す。完了後の実データの変化、既定の遷移、新たな失敗・長時間待機の説明に必要な領域拡張は別に扱う。
- 視覚表示と読み上げは同じ通知単位を使う。`aria-busy` は更新対象に付け、開始・結果を伝える live region がその busy によって通知を保留されない構成にする。複数の live region で同じ進行や結果を繰り返さず、通知のために focus を移動しない。
- error、not found、empty、stale data を別状態にし、更新と再試行は [操作文法](#更新再試行初期化破棄) で定めた回復契約に従う。
- empty state の導線は現在の権限と前提条件で実行可能なものに限り、安全な主要操作を1件示す。
- 補助情報の取得に失敗しても、取得済みの主表示は保つ。保存の確定と、その後の表示用 data の再取得は結果を区別し、再取得の失敗は再取得の失敗として伝える。結果不明と確定した成功・失敗も区別する。

完了・失敗の通知先は画面ごとの慣習ではなく、結果の確認場所と回復の必要性で決める。

| 状況 | 通知先 |
| --- | --- |
| 保存・作成・確定・削除後に遷移、または操作面が閉じ、完了の確認場所が残らない | 確定した結果を短い toast で一度知らせる |
| 結果が同じ場所に明瞭に残る | 結果表示を使う。保存確定が値だけでは分からない場合は操作付近の短い完了表示を使う |
| 一覧の手動更新、filter / page 変更、付随する再取得の成功 | 待機表示を終了して結果を示す。毎回の成功 toast は追加しない |
| 入力不備、操作不能、保存・削除・取得（再取得を含む）・download の失敗、結果不明 | 操作文法に従って原因・影響と回復手段をその場に残す。toast だけにしない |
| OCR・分析などの非同期処理 | 受付・開始と完了を区別する。継続中の状態と回復操作は対象領域に残す |

- 同じ結果を toast と inline notice へ二重に出さない。状態がすでに明らかな選択、通常の入力復元、cache の再取得だけを理由に toast を増やさない。遷移理由など、その場から失われる重要な文脈は短い通知で補ってよい。
- toast は同じ実行結果の重複を除き、別の対象・別の実行を文言の一致だけで消さない。共通 host が表示上限、閉じる操作、表示寿命、読み上げを所有する。上限外の通知は表示領域を占有せず、閉じた通知は操作・読み上げの対象から直ちに外す。[Web 実装規約](web-rule.md#client-lifecycle--suspense--motion) で許容する有限の非対話的な退出表示が終わった後に、内容や空き領域を残さない。
- toast の表示位置は、主要操作、fixed / sticky action、入力中の control を覆わないよう共通 host が所有する。画面固有の主要操作が下端にある場合は上端へ配置するなど、通知を閉じるまでタスクが停止する重なりを作らない。通常の画面遷移や描画部分の初回準備の間も、伝えるべき完了結果を保つ。

### 操作面の反応

- 文字・icon・寸法を保ち、面の濃さで操作へ応える。操作可能性、選択・tone・invalid の意味、一時的な hover / pressed、focus を分ける。意味の基底色と hover 量を分離し、状態の発生・解除を hover の補間へ巻き込まない。
- hover は開始遅延 0、共通の 100ms・cubic-bezier(0, 0, 0.58, 1) で現在値から補間し、反応を蓄積しない。pressed・focus・操作制限と、意味を認識する表示は即時に返す。非必須の補間は動きを減らす設定で省略し、touch から hover を作らない。既存の矢印・indicator の補間とは用途を分ける。
- 操作部品は通常 → hover → pressed で面の濃さを小さく増す。編集用 control へ押し込み表現を足さない。選択済みでも変更可能なら選択の印を保った反応を返す。invalid / review / warning / success はその意味色の範囲で応答し、通常 hover 色で覆わない。readOnly は編集不可として扱い、focus・文字選択・copy を保つ。
- 表の行は操作部品より弱い hover で読む位置を補助する。子 button は独立して反応し、親の反応量を継承しない。行全体へ pressed、pointer cursor、tabIndex を追加しない。面のない本文 link は既存の下線等を維持する。
- 共通 data table は、子操作の `:focus-visible` に連動する薄い行背景で対象名との対応を補助する。子の focus 枠を主表示にし、固定セルまで同じ不透明な行面へ接続する。hover と加算せず、focus 取得・解除は即時。その時点の hover へ戻し、最後の focus 行や処理中の行を記憶しない。別行の hover は併存できる。子の無効化を他の操作・行全体へ広げず、`aria-busy` だけから focus や操作制限を作らない。
- 色対・反応の接続は shared UI が所有し、feature は既存の用途・状態 props で利用する。部品別の時間・任意色・エフェクト指定を公開せず、独自 link や render 差替えも実要素の接続を確認する。hover のために新しい wrapper や余白を追加しない。実装の接続は [Web 実装規約](web-rule.md#client-lifecycle--suspense--motion) に従う。

### モーション

- motion は、操作への即時 feedback、状態の因果、同じ対象の連続性を補助する場合だけ使う。文字、形、位置、accessible state だけで意味を成立させた上で、動いたこと自体を見せ場にせず、注意深く見れば変化を追いやすい程度に抑える。
- 有限の motion は用途に対応する共通 token を使い、主に opacity と transform を使う。操作面の hover は上記の色反応に従う。値そのものの変化を伝える図表や数値は、その mark または値だけを補間してよい。周囲の layout shift、bounce / overshoot、stagger、視線を奪う移動を作らない。
- application state を animation 完了に依存させない境界は [Web 実装規約の Client Lifecycle](web-rule.md#client-lifecycle--suspense--motion) に従う。
- disclosure の本文は開閉状態と同時に配置・操作対象へ反映する。矢印の補間や primitive 内部の presence 管理によって閉じた本文の高さを残し、移動先の focus・表示位置を後からずらさない。
- route content、Suspense の fallback と完成内容、初回 content、一覧 row を、登場または置換そのものの演出として animate しない。異なる pathname の loading は structural fallback、同一 pathname の更新は既存内容の維持と局所 feedback で表す。
- 楽観更新の pending、confirmed、error は、文字、accessible state、disabled、局所 error / retry のうち必要な手段で静止状態でも区別する。同じ安定した identity の `pending -> confirmed` では局所的な属性だけを補間してよいが、追加・削除の presence motion は、rollback、server correction、同時 mutation を含む必要性と正しさを先に検証する。
- viewport への進入を初回 motion の trigger にしない。図表は初めから完成値を描画し、その後、現在表示中の同じ対象に値変更が起きた場合だけ補間してよい。表示領域外で変わった値は完成値へ即時反映し、再進入時に再生しない。
- 常時 loop は処理時間が不定な loading feedback に限り、完了後または対象外になった時点で停止する。非必須 motion は `prefers-reduced-motion` で無効化する。

## ナビゲーションと有限のタスクループ

- ブラウザー title と主ナビの現在地は route の意味を示す。通常の pathname 遷移は安定した main landmark へ focus を移し、同じページの条件変更、履歴移動、隣接移動の専用 focus を上書きしない。未知の URL は黙って別 URL へ置き換えず、復帰先を示す。
- 詳細の前後移動は共通の前後移動 primitive が全幅で等幅の2列を所有し、前を始端、次を終端へ揃える。方向の矢印を外側へ置き、label と説明の行を対応させる。説明は全文を折り返して示し、既知の端や一時的な無効状態でも方向の位置を残す。戻る・作業をやめる導線は領域の始端に置き、同じ領域内の sample などの補助状態は終端へ分離する。dialog のキャンセルは確定操作と同じ footer 内で、DOM と視覚の両方で確定より先に置く。
- 閲覧の往復はブラウザーの戻る・進むに任せ、各画面の filter、sort、page、selection、hash はその画面の URL に保持する。遷移元を `returnTo` で連鎖させたり、閲覧履歴を独自に管理したりしない。画面内の導線は、所属開催、対象試合、一覧など行き先が明確なものにし、履歴へ戻る操作を重ねない。認証後の復帰と未保存入力の保護は、それぞれの契約に従う。
- 未保存入力は workflow の identity に属する。表示幅や同じ作業の補助 query を変えても保持し、別作業への移動・外部離脱では必要な破棄確認を行う。保存中の入力を送信 snapshot から切り離さず、完了前の離脱操作を結果判明後に勝手に再開しない。
- 完了・失敗・download は開始時の対象と形式に結びつける。画面や対象を離れた応答は、現在の選択を変えたり、別対象の結果として表示したりしない。中断可能な read / download は所有する画面の終了時に中断する。
- タスクは、きっかけ、最小の操作、確認できる結果、明確な終了からなる有限の流れにする。完了後の連続利用表示、緊急性の演出、予測不能な報酬、再利用させるだけの CTA は追加しない。仲間内の記録道具として利用を煽らず、記録を終えたら離れられるようにするためである。実績の固定配点のように、予め分かる規則で競争を楽しませることはこの禁止に当たらない。配点は [実績要求の配点](requirements/player-achievements.md#配点) を正本とする。
- 通知、再訪誘導、保存済み条件、shortcut は、要求で定義した利用者の便益と停止方法を持つ場合だけ使う。FOMO や不安、export を妨げる lock-in を作らず、通常経路と発見可能なラベルを残す。

## 4人の共通結果台帳

- OCR 確認の要約、試合詳細、開催結果、分析では、4人の同一性、順序、整列を共通の視覚文法として反復する。これは同じ card を複製する規則ではなく、文脈に合う表、列、行、図表へ変形してよい。
- 固定メンバーは `いーゆー → ぽんた → あかねまみ → おーたか` の順と名前で識別し、member sequence はこの順に [色と意味トークン](#色と意味トークン) の4色を対応させる。この順序と色順を共通台帳、分析表、4人を表すグラフ系列・凡例へ一貫して適用し、順位、指標値、試合ごとのプレー順で並べ替えない。ただし、1試合の順位・総資産を読む結果台帳と、開催一覧の各行で開催平均順位を読む開催ごとの順位は、1位からの順位順とする（同率は同じ順位とし、その中は canonical 順）。色は名前を補助する走査用の手掛かりとし、固定メンバーの同一性を色だけに依存させない。
- 固定メンバーを並べる表示の既定順は、前項の順位台帳を除き canonical 順とする。ただし、利用者が列見出しなどの明示された操作で並び替えを要求した詳細表は、その表の範囲に限って指定順を優先してよい。並び替え後も member sequence の色と名前の対応は変えず、現在の sort と既定順へ戻す方法を操作から判断できるようにする。共通台帳、要約、グラフ系列・凡例はこの例外に含めない。
- 試合記録の play-order sequence も `プレー順1=青`、`2=赤`、`3=黄`、`4=緑` とするため、固定メンバーの member sequence と異なる色が同じ人物へ付く場合がある。両者を併記するときは play-order marker だけに4色を使い、固定メンバー名は neutral にする。固定メンバー名と `プレー順N` は別の可視ラベルで示し、順位はどちらの sequence からも独立させる。
- 編集 workspace のプレー順の色はプレー順 marker primitive の丸印と番号ラベルへ集約する。行・card の外周の一辺だけを色付けし、角丸へ接続する装飾を重ねない。
- source image と連動する編集 workspace は、対応関係を保つため画像上の並びに合わせてよい。ただし、固定メンバー名と `プレー順N` を別のラベルとして各入力に示し、確定後は、1試合の結果台帳を順位順、共通台帳・分析表を固定メンバーの canonical 順で表示する。結果表示では順位、プレーヤー名、総資産を主情報とし、画面固有の補助指標は対象要求を正本とする。
- 前後の差は「改善」「後退」「維持」「初戦」と値を併記し、符号付き小数だけに意味を持たせない。
- 主要結果は同一スコープの比較取得と独立に表示し、比較の失敗または対象試合なしでも保存済みの結果を残す。試合の識別情報は文字として残し、ナビゲーションと出力は明示した操作として表す。

## 画面固有の要求

本節は、対象要求に正本がない画面固有の表示要求を置く。索引と本書冒頭が定める「画面固有の目的・順序・指標は対象要求が所有する」の明示的な例外であり、次の2項目は本節を正本とする。対象要求へ移す場合は、移動と同じ変更で本節の該当項目を削除し、参照元を更新する。

- トップページに確認可能な OCR 下書きがある場合は、現在の開催回に属するものを優先し、同じ開催回では試合番号が小さい未確認下書きを先にする。OCR 状態、開催日時、試合番号、確認または確定への1操作を最初の視覚的な錨にする。累積結果は進行を妨げない二次情報とし、下書きがない場合だけ現在の開催または累積結果を主役にする。移す場合の受け入れ先: [基本要求の MVP 画面](requirements/base.md#4-mvp画面)。
- 分析の入口は「平均順位の差が縮まったか」「最近の負けが通常より続いているか」「桃鉄型など別の型を試す根拠があるか」という会話へ答えられる構成にする。順位内訳、平均順位と差、直近範囲、総資産・収益を優先候補とし、型の変更は推薦ではなく根拠付きの仮説として示す。移す場合の受け入れ先: [比較要求](requirements/series-comparison.md#3-information-architecture--state)。

## 視覚レビューの観点

本節は visual review を evidence に選んだ場合に確認する観点である。自動検証と visual review の選択基準、静的検査・component test・Playwright の採用境界は [テスト・品質規約の UI の検証を選ぶ基準](test-rule.md#ui-の検証を選ぶ基準) が所有する。配置や微細な反応の一貫性を設計要求とすることは、その座標・DOM 構造・animation 設定を恒久 test へ固定する理由にはならない。

- screenshot は補助とし、視覚レビューでは hierarchy、読み幅、関係的余白、product specificity、restraint、structural fit を確認する。共通の文字・内容 pattern を導入するときは、適用する異なる用途の代表画面で、主情報・本文・メタ情報が同じ役割として読め、画面固有の優先順位や必要な注意を失わないことを確認する。component が親 slot に追従していること、狭幅と広幅で intrinsic constraint が保たれること、sibling 間の divider と部品 perimeter が二重にならないことも代表画面で確認する。初見点検と cognitive walkthrough で、目的、現在地、主要操作を説明できるか確認する。
- ウェイト変更では、通常の label・操作・metadata が主要結果と競合せず、残した主要強調がその画面で読むべき結果や問題に対応することを確認する。500 と 400 が同じ face でも見出しを判別でき、selected / disabled / error と現在地を太字だけに依存せず認識できること、文字幅の変化で折り返しや操作位置が破綻しないことも代表 viewport と状態で確認する。computed weight や太字の個数だけを合格条件にせず、OS ごとの描画を未確認ならその境界を報告する。
- page 最上部の可視タイトルを省略する変更では、空の header slot や余白が残らず主要 surface が最初の page scope になること、移した action が作用対象の近くにあり loading / terminal / ready で順序が一致すること、global navigation・landmark・section heading・control label から現在地と目的を説明できることを代表 route で確認する。
- 角丸または文字 scale を変える場合は、page surface、dialog、bounded panel、control、badge、画像 frame が同時に現れる代表画面で包含階層を確認する。読み幅を変える場合は短い通常文だけで合格とせず、長い日本語の description、notice、error を置いた wide viewport でも一行が readable measure を超えないことを確認する。文字を大きくした結果は、desktop と mobile の dense data view で欠落、衝突、不自然な縮小、page 全体の横 scroll がないことを確認する。
- 余白 scale または spacing owner を変える場合は、ready だけでなく loading、error、empty、dialog の body / error 有無、fixed feedback を含む代表状態で、header、surface、section、action の位置が不意に移動しないことを確認する。mobile と desktop で同格の component の内余白が揃い、group 間が group 内より明確に広く、表・図表の走査密度を損なわず、focus outline が隣接 action と衝突せず、safe area を含む左右の viewport gutter が欠けないことを visual review する。
- 製品横断の階層、IA、固定メンバー / プレー順の意味を変える場合は、影響する利用段階の代表画面で、初見でも「いま見る対象」と「次の操作」を理解できるか確認する。grayscale / blur でも主役が残ること、色なしで役割を区別できること、順位がどちらの sequence にも見えないこと、通常状態で信頼性の注意が出ないこと、同じ事実や内部都合を反復していないことも確認する。理解や読みやすさを一律の秒数・評点へ置き換えず、判断した文脈と所見を伝える。
- OCR 結果修正または手入力 workspace の構造を変える場合は、画像と field の対応を理解でき、入力を保ったまま修正を完了し、誤操作から戻れるかを現行の操作と比較する。完了時間、誤修正、操作数の測定は、定性的な確認だけでは解消できない具体的な疑問がある場合に選ぶ。単一の数値が良くなったことだけで採用を決めず、利用者の負担と保守性を合わせて判断する。
