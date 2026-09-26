# Webテストの再レビューと再設計

対象は `apps/web` の全テスト、共通fixture・double・setup、Vitest / Playwright設定、E2E起動script、関連CI。判断基準は [テスト規約](test-rule.md)、[テストアーキテクチャ](test-architecture.md)、[Change Gates](dev-rule.md#4-change-gates)。要求された結果から証拠を選び直し、既存のケース数や実装構造を受入条件にしない。

## 1. レビュー結果

最も大きな問題は、実装を壊しても成功するoracle、実画面を通らない代替実装、異なる境界の証拠の混在だった。テスト本体の不具合を修正し、実装と独立した期待値・実操作・通信内容へ置き換えた。アプリケーション本体の挙動変更は含めない。

| 問題 | 見逃していた反例 | 修正後の判定 |
| --- | --- | --- |
| 閉じたSelectの表示だけで候補の絞り込みを判定 | 他作品のシーズンを候補に混ぜても通る | listboxを開いて候補集合と選択後の検索条件を確認 |
| 編集値の保持テストで値を編集しない | 保存失敗時に初期値へ戻っても通る | 値を変更し、保留・失敗・再送の画面値とHTTP payloadを確認 |
| 古い応答の完了後にcacheを再更新してから判定 | 競合で追加行が消えてもテストが修復する | 古い応答の完了直後に保存済み行が残ることを確認 |
| handoffの権限違いと期限切れが重なる | accountを無視しても期限切れで拒否される | 有効期限内の正常読取りを先に成立させ、別accountと改変payloadを区別 |
| 分析画面の本体を独自の簡易FlowViewに置換 | 実グラフや補助表が消えても通る | 実Page・実FlowView・Query・MSWで数値表、フォーカス、更新後の継続を確認 |
| 非同期の拒否が完了する前に否定assertion | 遅れて誤保存・誤表示しても通る | 制御した応答の完了とUIの復帰を待って判定 |
| ダウンロードを成功文言・URLだけで判定 | 空ファイル、異なる内容、破損文字コードでも通る | MでBlobのbyte列・MIME・解放順序、実APIのXLで保存したTSV内容を確認 |
| 再選択・再試行ボタンの存在だけを確認 | クリックしても復帰しない | 消失対象から別候補を選び、再ダウンロードまで操作 |
| 一覧のURLだけを確認 | URLだけが次ページになり旧行が残る | URLに加え表示行・件数・戻った際の内容を確認 |
| jsdomのclass・子要素数を視覚品質の根拠にする | CSSが効かなくても通り、無害なDOM変更では落ちる | Mは意味と操作、寸法・overflow・描画・実フォーカスはbrowserへ分担 |
| E2EとPlaywright設定が型検査対象外 | Responseの取り違えや不正fixtureが実行時まで分からない | 同じstrictなtypecheckにE2E・設定も含める |
| 標準runnerは開発サーバー、認証caseは本番挙動を前提 | 実行方法により同じsuiteの受入条件が成立しない | build＋previewで通常E2Eの前提を統一し、外部runtime指定は維持 |
| E2E runnerの起動失敗・中断・子プロセス所有が不明瞭 | 失敗がreadiness timeoutへ化け、起動した資源が残る | 実プロセスを使うrunner回帰と所有資源の終了処理を追加 |

### 初回レビューの到達点

初回は oracle の妥当性と実行境界の整理を中心に、次を改善した。

- 実API smoke、制御したbrowser response、route接続、featureの状態遷移を分け、ケース名に検証する結果を記す。
- cleanupとQueryClientの所有を共通setupへ集約し、各suiteに復元順序を複製しない。
- DOM内部・CSS class・生産実装で作った期待値を減らし、利用者が受け取る値と操作をoracleにする。
- 本書とテストアーキテクチャに境界・残した証拠・廃止理由を記し、fixtureの型検査とrunner gateを通常CIへ接続する。

独立reviewで通常Tab到達とPlaywrightの取消方式の抜けも検出し、それぞれの所有境界へ戻した。ただし、正しく検証できることと、その検証を維持する価値があることの区別が不十分だった。jsdom の配置検証を browser へ移すだけでは過剰検証を解消できていなかったため、第4節で採否を見直した。構造の自己採点を必要十分性の根拠にはしない。

## 2. 再設計した証拠の境界

| 境界 | 所有する証拠 | 対象の代表 |
| --- | --- | --- |
| S: process内の値変換 | 同値class、境界値、独立した期待値、可逆性・不変条件 | numeric draft、日時、request、query key、cursor、artifact decoder |
| M: component / hook / HTTP double | 実component、入力・keyboard、要求payload、保留→成功／失敗→再試行、race・cache・解放 | 入力・OCR送出・設定管理・一覧・開催・分析・export、共有UI、principalとstorageのhandoff |
| M: app composition | 認証・lazy route・Suspense・障害回復・遷移の接続 | router、AppShell、RouteErrorBoundary |
| M: route terminal presentation | 読み込み不能でも既知の文脈と安全な退出先を提供 | RouteTerminalPage、RouteSuspenseFallback |
| XL: browser + 制御したHTTP | 実描画、focus/inert、scroll、responsive、履歴、画面の非同期継続 | analysis-browser、page-contracts、pagination-continuity、design-system、ui-conformance |
| XL: browser + 実API | 認証、入力・保存、編集・削除、download、OCR uploadの実接続 | app-smoke、専用OCR notification E2E |
| Pipeline integrity | 型、wire fixture、生成物、runnerの終了契約 | typecheck、contract:check、build、e2e:check |

通常E2EのOCR uploadはアップロードと下書き生成の接続、dev-sampleからの確認は試合確定経路として別々に扱う。別入力で成立した確認を「アップロード画像のOCR結果を確認した」とは主張しない。専用OCR E2Eの制御worker・通知sinkも、実OCR精度や外部通知providerの保証には広げない。

runnerのプロセス終了helperは所有する同一プロセス群を停止する。Playwrightは別groupでbrowser / webServerを起動するため、通常の取消ではPlaywrightのSIGINT teardownも通す。`pnpm`経由ではteardownが完了しない反例を実CLIで確認したため、installed CLIをNodeで直接起動する共通adapterを使う。回帰テストもこの実adapterを通し、終了markerと別groupのwebServerの停止を観測する。任意のSIGKILL後に孤児化した別groupまで回収する一般的な監視機構とはしない。

### 共通ライフサイクル

`src/test/setup.ts` は画面のunmount、登録したQueryClientの解放、CSRFの消去、spy・global・envの復元、storage・observer・timerの後片付けを所有する。storageの失敗を模擬するspyは、実storageを消去する前に戻す。専用double自身が変更したpropertyなど、共通setupが所有しない資源は従来どおり呼出側が解放する。

MSWは未処理requestを失敗させ、suiteごとのhandler/state resetを維持する。Vitestのfile isolationも維持し、速さだけを理由に共有状態を許容しない。Queryのretry無効化や制御したPromiseは失敗経路を決定的に観測するために使い、実APIのwire接続は上位の証拠で別に確認する。

### 廃止・移動と維持判断

| 整理した証拠 | 判断と移管先 |
| --- | --- |
| `jestDom.test.ts` | ライブラリ自体のassertion実行を廃止。独自型拡張は`jestDom.typecheck.ts`でcompile時に検証 |
| `SkipLink.test.tsx` | native linkの存在確認を重複させず、routerの接続とbrowserのTab到達・mainへのfocus・操作継続で確認 |
| `MatchWorkspaceLoading.test.tsx` | CSS構造の写しを廃止。Create/Edit/Reviewの読込中操作と読込後の値で確認 |
| `MatchWorkspaceOperationFeedback.test.tsx` | 実経路にないerror modelの組立を廃止。実HTTP失敗による作成・確定・削除・更新・再試行の画面で確認 |
| `confirmMatchFormSchema.test.ts` | 同一schemaの重複検証を統合。consumer validationとrequest変換に日時・数値・メモの独立oracleを残す |
| `masterId.test.ts` | opaque IDのslug形式を契約にしない。実HTTP作成の再試行で同じID、次のintentでは別IDを検証 |
| router内の分析resourceケース | lazy route接続はappに残し、publication・expiry・scope変更の6ケースを実Pageの`SeriesComparisonResourceLifecycle`へ移動。既存feature evidenceと同義の2ケースは統合 |
| ErrorBoundary内のroute表示ケース | 実例外の捕捉・再試行・lazy失敗reload・route変更による回復を残し、安全な退出先・encoded ID・handoffは実RouteTerminalPageへ移動 |

既存のartifact version/byte bound/排他的状態、CSRF・idempotency・download取消、保存不能なraw numeric、camera stream/object URLの所有、principal切替、未知の保存結果、権限変更、ページをまたぐ選択、キャッシュの世代・失効契約は保持する。これらは独立した故障を検出するため、上位smokeが成功しても削除しない。

初回はCSS contrastの算術検証、production buildのtheme check、browserの描画検証を分担していた。CSS source の独自解析と微細な描画測定は第4節の再監査で廃止した。最終assetの保持checkは維持する。coverageは不足箇所を探す補助で、ケース数・行数・率の増減を品質の合否へ置き換えない。

## 3. 検証

通常Vitestとcoverage付き全件実行は重ねず、最終全件はcoverage付きで実行した。

- Vitest: 165 files / 1,035 tests通過。coverageは非blockingの診断資料として生成。
- Playwright: production build＋新しい起動adapterで通常26ケース通過。専用OCRは4ケース通過し、adapter変更後も新規DBで画面閉鎖・次の取り込みのcaseを単独実行して成功。
- Playwright MCP: 通常Tabでskip linkへ到達しmainへ移動、その後のkeyboard操作、375pxのアカウント表の横スクロール、1440pxで不要なscroll focus境界を外すこと、選択popup、documentの横overflowなしを実操作・画像で確認。
- runner / fixtureのNode test: 7ケース通過。実CLIの取消による内部の`interrupted`は意図した失敗入力であり、外側の回帰testはteardownとサーバー停止を確認して成功。
- format・lint・typecheck通過。既存のfixture不変コピーに関するlint warning 5件と生成decoderのchunk-size warningは残るが、新規warningはない。
- OpenAPI lint・Web生成型のfreshness、production buildとtheme保持check、public safety check通過。
- 全件検証で見つかったReview再取得の完了待ちを修正し、当該suiteと全件coverageを再実行。通常入力のvalidation alertとHTTP再取得失敗を混同せず、新しい応答値の反映を待つ。
- 終了時の非同期通知例外を初回担当runで1件観測。最終全件と当該suiteでは再現せず、別途見つけた確定mutationの完了待ち不足も修正して22ケースを再検証した。最初の例外との因果は断定していない。
- 日時変換とrequest変換はUTC・Asia/Tokyoそれぞれ14ケース通過し、開発環境とCIのtimezone差に依存しないoracleを確認。
- テスト所有のcontainer・一時image・process group・runtime directoryとMCP tabは回収済み。今回追加したWorker検証imageも削除した。

browserの検証範囲はChromium。実カメラ機器、外部OAuth / 通知provider、制御fixtureに置き換えたworkerの計算・OCR精度、任意SIGKILL後の別process group回収は、このWebテスト再設計の成功から保証しない。

参照した現行API資料はContext7経由の[Vitest](https://vitest.dev/guide/)、[Testing Library user-event](https://testing-library.com/docs/user-event/intro/)、[Playwright](https://playwright.dev/docs/best-practices)。設定・commandの正本はrepository内の実行設定とCIとする。

## 4. 2026-09-26: 利用者影響と保守費用による再監査

OCR退出導線の修正で報告した41件は、関連する既存4 suiteの実行総数だった。新規caseの純増は1件だが、既存caseにも本文の内外・読解順・3幅の座標測定を追加していた。配置の統一という要求から自動回帰testを直接導いた判断を撤回し、これらのassertionを削除した。退出先の安全性と画像の破棄確認・保持は残す。

監査は全165 Vitestファイルを共通UI・app（52）、feature（91）、共通API・domain・lib（22）へ分担し、標準28件と専用OCR4件のE2E、runner / fixture、共通setup、double、型検査、build checker、CIの実行構成も確認した。削除候補は境界をまたいで照合し、単なる件数削減や上位smokeへの一括置換を採用しなかった。アプリ本体、依存version、業務schemaは変更していない。

| 整理した対象 | 判断と残した証拠 |
| --- | --- |
| 座標・幅・余白・hover色・animation設定・骨組み | OCR退出、loading / ready位置一致、人工的な親幅、16:9寸法、hover補間、skeleton構造を恒久testから除去。必要な変更時のvisual reviewで扱う |
| CSSの独自解析と型による装飾prop禁止一覧 | sourceを解析するcontrast計算と全leafのprop一覧を削除。部品の型定義は維持し、動的な識別子がproduction CSSに残るbuild checkerは保持 |
| ラベル・slot・primitiveの反復 | status / rank / member label、FactList、FilterBar、説明・skeletonの単独suiteとページ上の同義caseを削除。keyboard操作や入力保持は共有primitiveと実flowの所有境界へ絞る |
| helperと設定の直写し | formatterのprefix / fallback網羅、null除外・assertDefined、query keyの固定配列、poll設定の存在否定、冗長なboolean組合せを除去。日時・金額変換、対象別cache、確定不存在、再送キーは維持 |
| 分析のE2Eとcomponentの重複 | 指標・全セル・SVG数値の分岐はcomponent側を維持。browserは対象選択、根拠リンク、履歴、keyboardでの到達・続行に絞る |
| 結果を区別できないoracle | 再送キーの配列位置を落としても通る判定に、位置の異なるpayloadとの非同値を追加。初期値のままだった入力保持検証は実編集へ変更。値を用意せず保持を主張するcaseや、実処理を開始せずOCR処理中と見立てるcaseは廃止 |

OCRのslot→request、開催内番号と分析番号の使い分け、数値入力・一時保存・handoff、権限、競合、未知の保存結果、再試行、downloadのbyte内容、カメラ資源、実processの取消と所有資源回収は残した。標準E2Eと専用OCRの責務も分けたままにする。

削除候補の `createEmptyMatchForm` の初期値検証は独立レビューで維持へ戻した。domain定数の検証だけでは、手入力フォームがmember・playOrder・rank・ownerを保存に使う初期値へ正しく取り込むことを確認できないためである。

規約は、観測可能であることだけを自動化の理由にせず、データ保全・正しい判断・操作続行への影響と独立した検出価値で選ぶ方針へ改訂した。モーションの全条件や補間途中値の検証を一律に要求せず、accessibilityによる操作成立とは区別する。廃止した自動検証を全変更で必須の手動チェックリストへ置き換えず、実行総数と新規追加数も分けて報告する。

### 整理後の検証

| 対象 | 再監査開始時 | 整理後 | 今回の実行結果 |
| --- | --- | --- | --- |
| Unit / component | 165ファイル・1,039件 | 140ファイル・855件 | 全件成功 |
| 標準E2E | 28件 | 22件 | 22件の成功を確認 |
| 専用OCR E2E | 4件 | 4件 | 今回は再実行せず。変更は共通overflow補助assertionとimportの除去のみ |

削減した184件と6件はcaseの統合による見かけの減少ではなく、低価値または重複するassertion・fixture・helperを除去した結果である。正常な保存・復旧等のcaseをskipへ移していない。

- Vitestは最終状態を一度全件実行し、140ファイル・855件が成功。通常実行とcoverage実行を重ねていない。
- 標準E2Eは初回21件が成功。整理中に新たに加えた、再openした選択popupのEscape後にtriggerへ必ずfocusを戻す期待が1件失敗したため、その追加条件を撤回した。元からあったkeyboard操作による未確定値の保持と次入力への到達に絞り、影響1件を再実行して成功した。
- 上記のfocus差は単なる表示待ちではなく、実browserでも再現した。Playwright MCPでpopupの準備完了後を観測し、初回Escapeでは親dialogを閉じず、Tab後の再open / Escapeではfocusが親dialogへ戻ることを区別した。そこからTabで入力・編集・キャンセルを完了できたため、今回のtest整理で新たな厳密な復帰先や製品修正を加えなかった。初回のunit testの成功を、別条件の全focus保証へ広げない。
- Playwright MCPでは、実APIを使って未完成の数値入力をdesktop→mobileで保持し保存を拒否すること、元の保存値が変わらないこと、正しい数値の保存とreload後の反映、OCR画像破棄のキャンセルによる保持と明示破棄後の退出を確認した。
- runner / fixtureのNode test 7件、既存ローカル起動runnerの7件は成功。隔離・取消・所有資源の回収を守るため維持した。
- format / lint / typecheck、public safety、diff checkは成功。lintの既存warning 5件は継続。製品コード・build設定は不変のため、直前に検証したproduction buildをbrowser実行に再利用した。
- テスト所有のAPI / preview、隔離container、一時runtime directory、MCP tabは回収済み。

専用OCRの4件は受付・部分失敗・同一intent再送・画面閉鎖後の回復を引き続き所有する。その本体・fixture・runtime設定は変えておらず、前回の成功範囲を再利用した。今回新たに専用Workerや外部providerの動作を確認したとはしない。browser実行はChromiumで、実機カメラ・他browser・スクリーンリーダー実機は今回の確認範囲外である。
