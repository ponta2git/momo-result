# ページ設計の再レビューと再構築

2026-09-25。対象はルートに登録された全13ページ、設定管理の全5パネル、認証・権限・未定義URL・遅延読み込み・例外の共通画面。
部品の契約は [UI system review](ui-system-rebuild.md) に従い、ページでは表示対象、入力、操作、応答、遷移の寿命を再設計する。

## 評価方法と受入条件

React の state ownership / immutable projection、TanStack Query の current / placeholder / refetch error、React Router の URL と focus、Base UI の keyboard contract、Tailwind と semantic token の責務境界を実装経路から確認する。
初期表示だけでなく、遅い応答、順序逆転、同一・異なる対象への移動、再試行、保存中の追加入力、履歴移動、空データ、認証失敗を検証する。

UI の主観評価は初期 **6/10**。部品の一貫性は整った一方、入力の消失・別対象への応答混入が操作結果を不確実にしていた。
重大度は 0=問題なし、1=軽微、2=回避可能な不便、3=主要操作の誤り/入力喪失、4=広範かつ回避不能な破損とする。
「10/10」は見た目だけでは判定しない。全対象で表示と送信内容の一致、古い応答の隔離、操作の復帰経路、キーボードと実ブラウザーでの成立を満たし、未確認事項を明示することを受入条件とする。

## 全画面の責務

| ページ | 所有する状態と受入契約 |
| --- | --- |
| ログイン | 未ログイン・権限なし・確認中・確認失敗を分離し、安全な `next` を再試行後も保持 |
| 試合一覧 | URL 条件と一覧 scope、確認待ちへの最新の移動意図。離脱後の応答で遷移しない |
| 試合詳細 | 試合本体と隣接一覧 snapshot を分離。404、メモ、削除、戻り先、分析状態を保持 |
| 開催一覧 | 一覧条件と作成コマンドを分離。作成成功で元の履歴 entry を書き換えない |
| 開催詳細 | 開催情報・試合一覧・隣接状態の取得失敗と回復を分離 |
| 手入力 | 表示中の文字列を含む入力 draft、validation、保存 snapshot、離脱保護を一致 |
| 試合編集 | 上記に加え試合IDで draft を分離し、別試合の値を復元しない |
| OCR 入力 | 選択画像・送信 snapshot・離脱意図の寿命を揃える |
| 読み取り確認 | session / draft ID、元画像、入力、設定管理との往復を一貫して保持 |
| 出力 | URL の対象・形式と進行中の操作/結果を対応させ、別条件へ古い応答を表示しない |
| 戦績比較 | artifact / scope / view に結びついた表示 bundle と詳細選択。安全な同一対象更新は操作を維持 |
| 分析管理 | 対象別/全体のコマンド結果と再試行を分離。rejection と古いエラーを残さない |
| 設定管理 | 作品・マップ・シーズン、名寄せ、事件簿、通知、アカウントを独立して読み込み、入力と操作結果を正しい対象へ結びつける |
| 共通の終端・遷移 | ページ固有の title、通常遷移の main focus、未知URLの保持と復帰、例外の可視見出し |

## 検出した主な問題と設計判断

| 重大度 | 問題 | 解消する境界 |
| --- | --- | --- |
| 3 | 空欄や符号だけの数値表示が以前の数値として保存される | draft をページで所有し validation / request が同じ入力射影を使う |
| 3 | 保存中の追加入力が送信に含まれず成功遷移で失われる | 保存 snapshot を固定し入力と離脱を保護 |
| 3 | 別試合が同じ一時保存 key を共有する | entity ID を session identity に含める |
| 3 | 設定管理の往復でメモなどの入力を失う | handoff schema と入力の保存・復元契約を一致 |
| 3 | OCR の再取得が編集中のフォームを再初期化する | 最初の編集可能 snapshot に入力・根拠・元画像を固定 |
| 3 | OCR 画像を選択した後の離脱で作業を失う | principal と作業単位の dirty / pending 保護 |
| 3 | 一覧から離脱/条件変更後の古い draft 応答が遷移を横取りする | route entry と最新の移動意図を持つコマンド |
| 3 | 分析の更新失敗後、URL と表示 view / 選択試合が食い違う | 保持する artifact を現在の view に射影し、別試合の context を除外 |
| 3 | SVG だけでは正確な数値へ到達できず、最大2,000点が Tab 順を占有する | 必要時に開く数値表と25件のページ送り、行単位の試合リンク |
| 3 | 出力で確認済みの不存在が古い候補や再取得によって復活する | domain の不存在を read-result に保持し、表示対象と送信IDを一致 |
| 2 | 分析対象が変わっても詳細選択が持ち越される | artifact / scope / view による詳細状態の破棄 |
| 2 | 同じ分析対象の更新でも本文全体が inert になる | 異なる表示 identity のみを保護 |
| 2 | 分析管理の非同期 rejection、別操作の古い失敗表示 | コマンドと対象に対応した feedback |
| 2 | 根元/ログイン画面で認証障害を未ログインとして扱う | 不明状態を明示し同じ URL で再試行 |
| 2 | ページタイトル・通常遷移の focus が一定しない、未知 URL が黙って消える | route metadata、main landmark、URL を保持する復帰画面 |
| 2 | 設定の作品切替で入力や完了結果が別作品に混ざる | 作品別 draft と作成 version、保存中の native disabled 境界 |
| 3 | 出力の対象変更や画面終了後に古い結果・download が発生する | 対象・形式を持つ request identity と AbortController |
| 2 | 保存中の戻る操作が、完了後に遅れて実行される | blocker の判断時に pending を記録し、結果確定後に離脱意図を破棄 |
| 2 | 閉じた mobile 数値欄のエラーへ focus できない | 対象 player / field を開いて最新入力へ focus |
| 2 | 開催作成後の履歴書換えで元の一覧ページへ戻れない | 一回の詳細遷移と既存一覧 entry の保持 |
| 1 | 無効条件の無言補正、特殊行列の scroll 到達点欠如、数値表の列潰れ | 理由を示す回復、共有 TableScrollArea、列数に対応する最小幅 |

正常に成立している current/placeholder の分離、保存確定後の cache 反映、設定の訪問済み panel 保持、隣接移動の見出し focus、同一 pathname の条件操作は保持する。
画面名を重複表示する装飾、不要なカード追加、機能と無関係な色・書体変更は設計に含めない。

レビューは入口ページだけでなく、その page model、query / command、URL 復元、loading / error / empty composition、設定の5パネル、全 score grid、OCR camera / capture / job、元画像、分析の全 view / chart / drilldown を対象にした。
統計計算を Worker が所有すること、immutable artifact と scope の整合検査、確定後の invalidation、画像資源の解放、OCR の送信 snapshot と同一 intent 再試行、業務 schema と idempotency は健全であり維持した。

責務の正本は [architecture](architecture.md#3-web) と [UI規約](ui-rule.md)。React Router の [accessibility](https://reactrouter.com/how-to/accessibility)、React の [state の保存とリセット](https://react.dev/learn/preserving-and-resetting-state)、TanStack Query の [query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) を照合し、component の key、入力所有者、cache の型、非同期処理の寿命を分離した。

## 検証記録

最終結果は Web format / lint / typecheck / build、public safety、diff check が通過。全 Web test は **169ファイル・1,096件**通過した。
Playwright の通常対象は **18件**の成功を確認した。最初の一括実行で17件が通り、残る出力候補のケースは list と summary の模擬応答が不一致だったため fixture を補正し、該当 spec の2件を再実行して通過した。分析管理の旧文言への完全一致も、送信対象名を含む受付結果と次操作の準備完了を検証する内容へ更新した。
lint の既存 warning 5件と、生成validatorのchunk-size warning は残っている。新しい lint error、型error、build error はない。

全ルートの component / router test と、操作の所有者である hook / query / command の回帰を組み合わせた。入力の保持は表示値と実際の送信内容、競合は制御した応答順序、cache は mutation 後の実再取得を oracle とした。

| 境界 | 主な証拠 |
| --- | --- |
| 共通ルート・認証 | title / main focus、条件操作の focus 保持、失敗からの再試行、権限、未知URLの保持 |
| 一覧・詳細 | 遅延した移動応答の無効化、履歴・hashの保持、初期 loading、pending write の戻る保護 |
| 入力・OCR | 不正数値の送信拒否、responsive 切替、対象別一時保存、handoff、snapshot 固定、画像の破棄確認、旧scope応答の抑止 |
| 設定 | 作品別入力・結果、pending 中の入力保護、訪問tabの保持、無効tabからの回復、通知設定の離脱保護 |
| 出力 | 初期候補と送信IDの一致、不在の再取得・古い候補・通信失敗、形式変更・離脱時の中断、cacheの形状分離と無効化 |
| 分析・分析管理 | 更新失敗後の view / match 整合、詳細dialogの対象境界、同一artifactの操作維持、数値表・ページ送り、受付対象とfeedbackの一致 |

Playwright MCP では本番ビルドの desktop / mobile 表示を確認した。設定の不要な空白を除き、狭幅の数値表は列を保った水平スクロールへ調整した。数値表の keyboard 到達・矢印scroll、ページ全体の横はみ出し、OCR の破棄キャンセルによる画像保持、ページ遷移と条件操作の focus を確認した。確認した browser console に error / warning はなかった。

実機のカメラ・ファイル選択UI、実際のスクリーンリーダー、外部認証providerの障害は今回の検証範囲外。API / Worker / DB の wire や業務処理は変更しておらず、OCR queue と外部配送の専用E2Eは再実行していない。単体での意味構造・keyboard 検証を、これらの実機検証の代用とはしない。
