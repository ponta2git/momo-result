# UI通知の対応表と実装計画

## 1. 位置付け

控えめな外観を保ちながら、処理中の読みやすさと操作位置を安定させ、通知の重複と不足を整理するための実装前の対応表である。「現行」はhandler・model・表示componentと呼び出し元をコードで確認した状態、「採用」は今後の実装で満たす表示を示す。全状態の実画面再現は未実施であり、この文書と規約の更新だけでは画面への適用完了を意味しない。

対象はアプリ内の待機・完了・失敗表示である。共通原則の正本は [UI規約](ui-rule.md#61-取得状態とフィードバック)、責務は [architecture](architecture.md#client-lifecycle--suspense--motion)、品質証拠は [test-rule](test-rule.md#4-web-evidence-catalog) に置く。本書は操作ごとの差分と実装入口を扱い、原則を別に定義しない。後続実装で対応済みとなった現行差分は削除し、独立した作業入口として不要になった時点で本書と索引の参照を整理する。

合意済みの範囲は次のとおり。

- 非同期buttonは「ダウンロード」から「作成中…」などの文言切替を残し、両状態の幅・高さを確保する。
- 同じ条件での一覧更新は内容を鮮明に保ち、操作の近くで待機を知らせる。
- 試合一覧を後続ページから更新した際、成功後に先頭ページへ戻る既存挙動は維持する。処理中の位置保持と、完了後のデータ・遷移は区別する。
- Toastは、遷移や操作面の閉鎖で完了の確認場所が失われる操作を中心に、アプリ全体で同じ判断基準を適用する。手動の一覧更新成功を毎回Toastにしない。

## 2. 共通UIと表示境界

| 対象・実装入口 | 現行 | 採用する対応 |
| --- | --- | --- |
| [Button](../apps/web/src/shared/ui/actions/Button.tsx) | 文言・iconをpending時に差し替える。通常とpendingの寸法を予約していない | 文言、icon有無、狭幅の折り返しを含めて寸法を確保。同じbutton本体、formのpending継承、二重送信防止を維持 |
| [IconButton](../apps/web/src/shared/ui/actions/IconButton.tsx) | 固定寸法内でiconとspinnerを切り替える | 既存寸法を維持。通知集約時もaccessible nameと操作制限を保つ |
| [StaleShield](../apps/web/src/shared/ui/motion/StaleShield.tsx) | 内容を保持する2方式の両方で減光・ぼかしとoverlay statusを出す | 同条件は読みやすさを落とさず操作欄で通知。条件差の誤操作防止とfocus復帰は保持し、通知と操作制限を分離 |
| [AppShell](../apps/web/src/app/AppShell.tsx)・[ToastHost](../apps/web/src/shared/ui/feedback/ToastHost.tsx) | route contentをSuspenseが囲み、ToastHostはその外にある。Toastの描画部分は遅延読み込み | 表示済み操作欄・surfaceを内部bodyの待機から分離。Toastの初回準備・描画失敗でも完了通知を失わないことを検証・調整 |
| [ToastRenderer](../apps/web/src/shared/ui/feedback/ToastRenderer.tsx)・[Toast](../apps/web/src/shared/ui/feedback/Toast.ts) | 共通managerへの追加と配列描画。上限超過通知の非表示を独自rendererで扱っていない | 表示上限を見た目と操作・読み上げに反映し、空き領域を残さない。同じ実行結果の二重通知を防ぎ、別操作を文言一致だけで除外しない |
| [Notice](../apps/web/src/shared/ui/feedback/Notice.tsx) | 状態・失敗・回復操作を局所表示できる | 持続すべき問題と再試行の確認場所に使用。Toastとの同一結果の重複や通常待機の説明枠を整理 |

試合一覧と開催履歴は通常queryで前条件の表示、部分失敗、再試行を扱っている。一方、[マスター管理](../apps/web/src/features/masters/useMasterResourceQueries.ts)と[試合workspace](../apps/web/src/features/matches/workspace/useMatchWorkspaceQueries.ts)では、初回に必要なdataにSuspense queryも使う。通知を集約するために取得方式を統一しない。Suspenseの採否は表示保持と独立した回復を簡潔に表現できるかで判断し、採用自体を再取得時の内容置換と同一視しない。

## 3. 操作ごとの対応表

「処理中」は、利用者がその操作を開始したときの代表表示を示す。複数queryや保存後の再取得が同じ操作に属する間も、各場所へ同じ待機表示を増やさない。初回の未準備な内容、独立した操作、静的に示す必要がある業務状態は、一括で隠さない。成功文言は対象と結果を示す案であり、最終文面はUIライティング規約に揃える。

### 3.1 試合一覧・詳細・記録・メモ

| 操作・実装入口 | 現行の主な差分 | 処理中の担当（採用） | 成功の通知（採用） | 失敗・回復（採用） |
| --- | --- | --- | --- | --- |
| [一覧の初回取得・条件／ページ変更](../apps/web/src/features/matches/list/MatchesListPage.tsx) | 初回skeletonと件数の確認文。条件変更は保持内容にぼかし・overlay・inert | 初回は準備範囲、条件変更は条件操作付近。未確定件数の意味と誤操作防止を保ち、重複演出を除く | 条件と結果表示。Toastなし | 一覧・件数・候補の部分失敗を区別し、それぞれ局所回復 |
| [一覧と件数の手動更新](../apps/web/src/features/matches/list/useMatchListResource.ts) | 更新buttonとStaleShieldが重複。同条件でも減光・ぼかし | 更新操作付近の一つ。表示中queryが取得中でない後続ページからの更新も、手動操作のpendingで捉える | 更新結果。先頭ページへ戻る既存契約を維持。Toastなし | 内容を残し一覧付近の警告と再取得 |
| [一覧・件数・候補の再試行](../apps/web/src/features/matches/list/MatchesStatusFilter.tsx) | toolbarと再試行が連動。件数再試行にはpending入力がない | 押した再試行buttonを維持。toolbarは重複実行を止めても別spinnerを出さない | 回復した内容。Toastなし | 失敗案内と同じ条件の再試行を維持 |
| [未確定記録の状態確認と移動](../apps/web/src/features/matches/list/useConfirmedDraftNavigationCommand.ts) | 行buttonに確認中。状態変化の説明と確認失敗はいずれもToast | 実行行のbutton。独立した別行の確認は別単位 | 通常移動はToastなし。状態変化で行先を変える説明Toastは維持 | 確認失敗は対象行付近に持続表示と再試行を追加 |
| [詳細・補助名・比較情報の取得](../apps/web/src/features/matches/useMatchDetailPageModel.ts) | 初回skeleton。補助取得は主結果を残し、失敗Noticeと再試行 | 主内容の準備と補助値を分離。再試行は押したbutton | 結果表示。Toastなし | 主結果を維持し、対象項目の失敗と回復を局所表示 |
| [作成・OCR確認後の確定](../apps/web/src/features/matches/workspace/useMatchWorkspaceSubmitFlow.ts) | 確認dialogと背面主buttonに同じbusyが伝播。成功は詳細へ遷移、Toastなし | 確認dialogの確定button。背面はdisabledだけにする | 「試合を確定しました」のToastを追加 | 入力と局所Noticeを維持。既に確定済みで移動する競合回復は説明Toastのみ |
| [試合結果の編集保存](../apps/web/src/features/matches/workspace/useMatchWorkspaceMutations.ts) | 保存buttonがpending、成功は詳細へ遷移。Toastなし | 保存button。付随する再取得も同じ待機単位 | 「試合を保存しました」のToastを追加 | 入力保持と操作panelの失敗Notice |
| [確定前の記録の削除](../apps/web/src/features/matches/workspace/MatchSetupSection.tsx) | 削除dialogと背面主buttonにbusy。成功は戻り先へ遷移、Toastなし | 削除dialogの実行button | 「確定前の記録を削除しました」のToastを追加 | 削除操作近傍に失敗と再試行。対象・入力を保持 |
| [確定済み試合の削除](../apps/web/src/features/matches/useMatchDeletionCommand.ts) | dialog pending。成功は一覧等へ遷移、Toastなし | 削除dialogの実行button | 「試合を削除しました」のToastを追加 | dialog内で同じ対象を再試行。閉じた場合も必要な案内は記録情報内に保持 |
| [メモの追加・保存・削除](../apps/web/src/features/matches/useMatchNoteEditor.ts) | 保存後はeditorを閉じ本文へ、削除後は空状態へ。明示的な保存通知なし | 保存button、削除時は確認dialogのbutton | 同じメモ領域に「保存しました」／「メモを削除しました」。Toastなし | 未保存本文・競合・最新版と回復操作をその場に保持 |
| [workspace内で開催作成・選択](../apps/web/src/features/matches/workspace/useWorkspaceHeldEventCreation.ts) | 成功は開催を選択し「作成して選択しました」のToast | 作成dialogのbutton | 選択欄付近のinlineへ変更。結果の確認場所が残るためToastなし | dialog内の失敗と日時入力を保持 |
| [設定管理への移動・入力復元](../apps/web/src/features/matches/workspace/useMatchWorkspaceHandoffNavigation.ts) | 移動準備失敗、復元成功・失敗はToast。復元候補Noticeもある | 移動button。復元候補は既存の入力領域 | 帰還時の重要な復元文脈は一度のToast。同じ画面で明示的に復元した場合は候補Notice付近のinline | 移動準備失敗は操作付近、復元失敗は入力領域の持続警告へ変更 |
| [元画像取得・再試行・ZIP保存](../apps/web/src/features/matches/workspace/sourceImages/useSourceImagePanelState.ts) | 画像枠loadingと局所error。ZIPは保存button pending、成功はdownload開始のみ | 画像取得は画像枠、ZIP保存は保存button。それぞれ独立 | ZIPは操作付近に「ダウンロードを開始しました」を追加。Toastなし | 元画像sectionに失敗と再試行・利用可能な別手段を保持 |

メモ保存のinline完了表示は、既存の [メモ要件](requirements/match-note.md) の要求を満たすための差分である。メモ削除・workspace内開催作成ではdialogが閉じても同じ場所に結果が残るため、閉鎖だけを理由にToastへ変更しない。

### 3.2 開催履歴・開催詳細・出力

| 操作・実装入口 | 現行の主な差分 | 処理中の担当（採用） | 成功の通知（採用） | 失敗・回復（採用） |
| --- | --- | --- | --- | --- |
| [開催履歴の初回・ページ変更・更新](../apps/web/src/features/heldEvents/useHeldEventsPageModel.ts) | すべてのfetchでtoolbarがpending。ready時のStaleShieldとも重複 | 初回は準備範囲、同条件更新は更新button、ページ変更はページ操作付近。内容は鮮明に保持 | 結果表示。現在ページと削除後ページ補正の契約を維持。Toastなし | 内容を残し警告と再取得。stale時の削除制限を維持 |
| [開催履歴の再試行](../apps/web/src/features/heldEvents/HeldEventsListCard.tsx) | 再試行とtoolbarとoverlayが連動し、取得開始で案内が消える経路がある | 押した再試行buttonと案内を維持 | 回復した内容。Toastなし | 同じ場所のNoticeと再試行 |
| [開催履歴からの作成・削除](../apps/web/src/features/heldEvents/HeldEventsPage.tsx) | dialog pending中に背面の一覧再取得も待機表示。成功Toastあり | 開いているdialogの実行button。付随する一覧取得に重ねない | 既存の作成・削除Toastを一度維持 | dialog内に失敗・入力・同じ対象の再試行 |
| [開催詳細の一括更新・部分再試行](../apps/web/src/features/heldEvents/useHeldEventDetailPageModel.ts) | header更新と部分失敗の再試行が同じfetchで連動。案内が開始時に消え得る | 一括更新はheader、部分再試行は該当Noticeのbutton | 内容・表示名の更新。Toastなし | 内容と表示名の失敗を分け、取得済み内容と局所再試行を保持 |
| [出力対象の取得・選択・再試行](../apps/web/src/features/exports/useExportPageModel.ts) | 候補skeleton／確認文、picker pending、部分失敗Notice。pending未接続の再試行がある | 初回は候補枠。picker内取得はdialog、再試行は押したbutton。背面に重ねない | 対象表示。Toastなし | 対象不明・候補・表示名の失敗を区別し、利用可能な出力は維持 |
| [CSV/TSV作成・再試行](../apps/web/src/features/exports/useExportDownload.ts) | 主buttonと通常待機Noticeが重複。再試行開始で結果stateを消し操作が消える | 通常は実行button、再試行は押した回復操作を保持。長時間の説明は同じ操作の補足 | filename付き「ダウンロードを開始しました」をinlineで維持。Toastなし | 失敗・timeoutのNoticeと同じ条件の再試行を維持 |

出力の待機時間・timeout・download開始の意味は変更しない。通常の待機表示と、長時間・失敗・結果の説明に必要な領域拡張を分ける。

### 3.3 認証・OCR取り込み

| 操作・実装入口 | 現行の主な差分 | 処理中の担当（採用） | 成功の通知（採用） | 失敗・回復（採用） |
| --- | --- | --- | --- | --- |
| [ログイン・認証確認](../apps/web/src/shared/auth/AuthPanel.tsx) | 外部ログインへの移動中表示、route guardの認証確認・失敗・再試行 | 移動リンク、認証中は認証境界。各featureへ重ねない | 遷移先とログイン状態。Toastなし | ログイン・認証案内に失敗・権限不足と回復を持続表示 |
| [ログアウト・開発用アカウント切替](../apps/web/src/app/AppGlobalNav.tsx) | 現在の露出条件内でpendingと局所失敗・再試行 | 該当操作。露出条件を変更しない | ログイン状態・遷移。Toastなし | 操作近くに持続表示。アカウント境界をまたぐ旧通知を残さない |
| [OCR前提情報の取得・再試行](../apps/web/src/features/ocrCapture/useOcrCapturePageModel.ts) | 認証・別名・選択肢ごとの案内、読み込み中・開始不能理由が併存 | 必要な初回準備、再取得は設定欄の一つ。再試行buttonを維持 | 選択肢表示。Toastなし | 独立した問題と回復は各対象へ残す |
| [カメラ・画像配置・移動・破棄](../apps/web/src/features/ocrCapture/CameraCapture.tsx) | カメラpending／errorとtrayの操作結果。一部入力不備・操作拒否・draft取得失敗はToast | 起動・撮影button。画像操作はtrayの局所feedback | プレビュー・tray内の操作結果。Toastなし | 対象slot・カメラ・開始操作付近の持続表示へ統一 |
| [OCR開始](../apps/web/src/features/ocrCapture/useOcrStartFlow.ts) | 専用dialogのspinner／件数progress。全件開始Toast後に移動。部分開始はdialogに残る | 送信dialog。背面slotの通信待機を重ねない | 既存の読み取り「開始」Toastを維持。「完了」としない | 部分開始・後処理失敗・開始不能をdialog内に残す |
| [OCR状態確認・読取結果](../apps/web/src/features/ocrCapture/CaptureSlotCard.tsx) | slotのbusy badgeと状態更新button、slot内の問題表示 | 通信待ちは押した状態更新button。サーバの継続状態は静的なラベル | 読取結果と要確認状態をslot・記録に残す。自動Toastなし | slot内に取得・job失敗・分類不一致と回復を保持 |

### 3.4 マスター・アカウント・通知設定

| 操作・実装入口 | 現行の主な差分 | 処理中の担当（採用） | 成功の通知（採用） | 失敗・回復（採用） |
| --- | --- | --- | --- | --- |
| [マスター初回・作品切替・再試行](../apps/web/src/features/masters/useMasterResourceQueries.ts) | 共同初回取得にSuspense。マップ・シーズンは個別queryとskeleton、部分失敗Notice | 共同初回境界を維持。作品切替に伴う複数取得は一つの操作として通知 | 結果表示。Toastなし | 部分失敗と再試行は各対象に残す。事件簿は読取専用を維持 |
| [作品追加](../apps/web/src/features/masters/useMasterCreateActions.ts) | 送信buttonと楽観追加行に待機表現。成功時dialog閉鎖と新作品の選択、Toastなし | dialogの送信button。楽観行は未確定という静的な区別を維持 | 選択された作品と一覧付近の「作品を追加しました」をinline表示。Toastなし | dialog内の入力error・失敗 |
| [マップ・シーズン・別名のinline追加](../apps/web/src/features/masters/MasterCreateForm.tsx) | button pending、楽観行、成功時一覧追加・form reset | 送信button。未確定行へ二つ目の動く表示を増やさない | 一覧とform近くの短い結果表示。Toastなし | 入力errorを保持。追加成功と再取得失敗を区別 |
| [マスター編集](../apps/web/src/features/masters/useMasterEditCommands.ts) | dialogの保存button pending、成功時閉鎖し同じ行に変更後の値が残る。Toastなし | dialogの保存button。関連取得の待機を重ねない | 対象行付近に保存完了をinline表示。Toastなし | dialog内の失敗と同じ対象の再試行 |
| [マスター削除](../apps/web/src/features/masters/MasterActionDialogs.tsx) | dialogの削除button pending、成功時にdialogと対象行が消える。Toastなし | dialogの削除button。関連取得の待機を重ねない | 対象種別を示す削除Toastを追加 | dialog内の失敗と同じ対象の再試行 |
| [マスター管理から記録へ戻る](../apps/web/src/features/masters/useMasterReturnRoute.ts) | 移動button pending、戻り先・復元errorはページNotice | 移動button | 通常移動のToastなし。復元結果は記録側の方針に従う | 復元不能理由と回復を持続表示 |
| [アカウント一覧取得・再試行](../apps/web/src/features/adminAccounts/useAdminAccountsPageModel.ts) | 初回skeleton、失敗・stale Noticeと再試行 | 初回の準備範囲、再試行button | 一覧表示。Toastなし | 一覧を保持し、再試行案内を維持 |
| [アカウント追加](../apps/web/src/features/adminAccounts/AdminAccountCreateDialog.tsx) | 追加中、成功時dialog閉鎖・trigger focus。Toastなし | dialogの追加button | 「アカウントを追加しました」のToastを追加 | dialog内の入力・失敗Notice |
| [ログイン可否・管理者権限変更](../apps/web/src/features/adminAccounts/AdminAccountRow.tsx) | 確認dialog pending、行のaria-busy、成功Toast。変更で行順や自身のアクセス状態も変わり得る | 確認dialogの実行button。行に通信spinnerを増やさない | 確認位置が失われ得るため既存成功Toastを維持。認証終了でhostも失う場合は認証案内に結果を引き継ぐ | dialog内に失敗と回復 |
| [通知設定保存・OFF確認](../apps/web/src/features/notificationSettings/useNotificationSettingsPageModel.ts) | dialogと背面保存buttonが同じpending。成功Notice後にも再取得文 | dialog開中は確認button、それ以外は保存button | 保存済み値と既存inline Notice。Toastなし | 失敗・競合・結果不明と選び直しを持続表示。保存確定と再取得失敗を区別 |

アカウント変更では、[一覧の並び順](../apps/api/src/main/scala/momo/api/adapters/postgres/PostgresLoginAccountsRepository.scala)と[認証情報の再取得](../apps/web/src/features/adminAccounts/adminAccountCache.ts)によって対象行や管理画面が維持されない場合がある。行に結果が残るマスターの名称編集とは通知先を分ける。認証案内に引き継ぐのはその操作の結果だけとし、別アカウントの通知として持ち越さない。

### 3.5 比較・分析管理

| 操作・実装入口 | 現行の主な差分 | 処理中の担当（採用） | 成功の通知（採用） | 失敗・回復（採用） |
| --- | --- | --- | --- | --- |
| [比較初回・条件／強調試合変更・更新](../apps/web/src/features/seriesComparison/page/SeriesComparisonPage.tsx) | 初回skeleton、更新button、状態再確認button、StaleShieldが併存し得る | 初回の準備範囲、通常更新は条件欄、再確認は該当button。条件・強調変更は条件操作付近に一つ | 比較結果・強調解除の説明をその場に残す。Toastなし | 部分失敗を各対象へ。必要なinertを保ち、全体blurと通知を分離 |
| [比較view・詳細dialog・再試行](../apps/web/src/features/seriesComparison/page/SeriesAnalysisContent.tsx) | code読込は局所Suspense、詳細dataは通常query。再試行でもloadingへ置換 | 同じbodyのcodeとdata準備を一続きの表示に。タブ・dialog枠を保持し再試行操作を消さない | 結果表示。Toastなし | 詳細内の失敗と再試行。ページ全体へ待機を広げない |
| [作品別・全作品の分析再計算受付](../apps/web/src/features/seriesAnalysisAdmin/useSeriesAnalysisAdminPageModel.ts) | 受付と状態更新が同時pending。受付Noticeが残る。全作品失敗はdialogと背面で重複し得る | 受付button／開いている全作品確認dialog。付随する取得にspinnerを増やさない | 既存の受付Noticeと実行状況。Toastなし | dialog開中の同じ失敗はdialogに集約。閉じた後も必要な回復はページに残す |
| [分析状態更新・作品切替](../apps/web/src/features/seriesAnalysisAdmin/SeriesAnalysisAdminPage.tsx) | 更新buttonまたは失敗Notice内の再試行、初回skeleton、実行状況・履歴 | 初回の準備範囲、状態照会は該当操作付近の一つ | 状態表を更新。照会・完了の自動Toastなし | 取得済み一覧を残し、失敗と回復を持続表示 |

分析の予約・受付・実行中・完了は別の結果であり、HTTP取得中の表示と混同しない。通知設定保存・分析受付は、dialog閉鎖後も結果が明瞭に残るためToastを追加しない。異なる分析成果物やviewに切り替える意図的なidentity変更と、pendingだけによる不要な再mountも区別する。

## 4. 後続実装への引継ぎ

1. 共通Buttonの寸法、StaleShieldの表示と操作制限、Toastの表示上限・重複・寿命を整える。
2. 試合一覧・開催履歴・出力から通知担当を適用し、比較・選択dialog・各保存系・管理画面へ揃える。取得やmutationの成功判定、cursor・入力保持、cache整合の契約は表示整理の都合で変えない。
3. 待機表示を減らした箇所では、部分失敗、再試行、既存内容の操作、読み上げが失われていないことを確認する。失敗・競合・結果不明を成功Toastで置き換えない。
4. [Web Evidence Catalog](test-rule.md#4-web-evidence-catalog)に従い、制御した通信で処理前・処理中・完了後を比較する。共通UIと代表画面で狭幅・広幅、折り返し、focus・scroll、連続通知、初回描画・遷移・失敗を検証する。実画面はPlaywright MCPを使う。

今回の成果は通知対応表の確定と規約の具体化までであり、この節の実装・検証は未着手である。実装時のgateは [Change Gates](dev-rule.md#4-change-gates) で変更範囲に応じて選ぶ。
