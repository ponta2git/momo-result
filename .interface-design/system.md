# momo-result Interface System

規約の正本は `docs/ui-rule.md`、現在のトークンと寸法の実行正本は `apps/web/src/styles.css` と `apps/web/src/shared/ui/` とする。このファイルは、今後の UI 作業で再利用する設計判断の索引であり、実装値を複製しない。

## Direction

- 静かな対戦卓に置かれた、作り込まれた試合台帳として設計する。
- 開催回、試合番号、順位、オーナー、確定記録を、走査しやすい順序と整列で表す。
- light mode、低彩度の neutral surface、既存の順位色と member sequence 色を使い、装飾目的の色を足さない。

## Foundations

- Depth: 通常内容は borders-only。shadow は dialog、tooltip、toast など浮遊 UI に限定する。
- Surfaces: page canvas と、連続する1タスクまたは1 data scope の content surface を基本とする。
- Spacing: 4px を基準とする既存 scale を使い、密接な要素より group 間を広くする。
- Typography: 既存の heading、copy、label、tabular numeral の役割を保ち、色・大きさ・太さを同時に最大化しない。

## Reusable Patterns

### Academic Data Table

- 親 table と同じ surface 背景を使い、通常状態を淡色面で強調しない。
- 小さな secondary text と semibold、table 上端と header 下端の横罫線で、data row より弱い階層にする。
- 本文行どうしの横罫線は引かず、最終行の下端だけを閉じる。外周の枠線、角丸、縦罫線を足さない。
- pagination の有無にかかわらず、共通 `DataTable`、body row、header pattern を使う。sortable state は操作部分だけに閉じる。

### Table-only Page Surface

- 一覧・管理画面が table だけでも、page header の次に通常 padding の `PageContentSurface` を置き、その内側に table を入れる。
- content surface は page と data scope の余白を所有し、table は academic data table の横罫線だけを所有する。
- loading、empty、error、pagination は同じ surface に従属させ、table と同化させる目的で `padding="none"` を使わない。

### Descriptive Choice Dialog

- 日時、件数、状態などを読み比べて開催や試合を一つ選ぶ場合は、現在値と変更 trigger を持つ共通 dialog field を使う。
- dialog 内は説明付き native radio group とし、任意選択では「すべて」「選択しない」も同じ候補列に置く。
- 候補が1画面に収まらない場合は、共通の compact pagination で API page を切り替える。page を移動しても現在の選択と表示 label を保持し、現在の候補が page 外なら選択済み候補を先頭へ補う。
- select、filter、edit、OCR、export で同じ対象を選ぶ場合は、用途固有の選択文法を作らず、この pattern を再利用する。

### Row Alignment

- 1行として走査する control、status、action cluster と通常の data table cell は中央揃えにする。shared interactive primitive が文字サイズ、行高、desktop / mobile の高さを所有し、global element selector から font shorthand で上書きしない。
- label と値、数値と単位、短い見出しと件数など、文字同士の対応を読む行は baseline を揃える。
- heading と lead、主情報と metadata など高さが変わる複合 record は上端を揃え、内容量の差で隣要素が上下へ移動しないようにする。
- field を横に並べる form row だけは各 control の下端を揃えてよい。table editor の top alignment と chart axis の bottom alignment は、対応関係を保つ局所例外として明示する。

### Continuous Match Timeline

- 順序付きリストの各 record に番号 marker を置き、1本の軸として読む。
- connector は隣接する marker の中心から中心までだけを結ぶ。record が `N` 件なら connector は `max(N - 1, 0)` 本とする。
- 最初の marker より上、最後の marker より下へ軸を伸ばさない。
- record 外周、平行な縦罫線、分断された card rail を足さず、marker、見出し、関係的余白で record を区別する。
