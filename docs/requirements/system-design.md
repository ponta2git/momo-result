# 桃鉄結果記録・集計アプリ 技術構成・非機能要件

目的: `docs/requirements/base.md` の業務要求を実現する技術構成と、可用性、セキュリティ、性能、運用上の達成条件を定義する。

専門正本:

- 実装境界: `docs/architecture.md`
- DB / migration: `docs/db-rule.md`
- OCR job: `docs/ocr-job-contract.md`
- 戦績分析: `docs/requirements/series-analysis-batch.md`
- UI / test / command: `docs/ui-rule.md`、`docs/test-rule.md`、`docs/dev-rule.md`

現在のframework version、directory、env名、threshold、workflow、provider設定は実装・設定を正本とし、本書ではその正本を参照する。

採用する構成は React/Vite の SPA、API、Processing Worker、共有 PostgreSQL とする。APIとOCRワーカーは同一リポジトリで分離する。

## 1. System Boundaries

- Web、API、Processing Worker、共有DB、object storageを独立した責務として扱う。
- WebとAPIだけが利用者向けHTTP runtimeを構成する。OCRと戦績分析は高負荷処理がHTTP可用性を巻き込まない独立Rust runtimeへ置く。
- APIは認証、入力検証、業務usecase、保存済み状態の読み取りを担う。OCR / 分析engineはHTTP requestの外で実行する。
- DBはsummitと共有するPostgreSQLを使い、schema / migrationは`../momo-db`が所有する。
- OCR / 分析は既存 DB の job を直接取得し、通知欠落からも回復する。
- upload画像は非公開object storageへ置き、DB / jobにはopaque keyと検証metadataだけを保存する。
- provider固有のtopology、resource、費用、実測、復旧手順はprivateに置く。

## 2. Web / API Contract

- WebはSPAとし、画面固有状態とserver stateを分離する。accessibility primitive、shared UI、semantic tokenを共通化する。
- client / serverの両方で入力を検証し、workflow identifierやmode discriminatorを変換後も保つ。
- APIのwire契約はendpoint定義を正本とし、OpenAPIとWeb生成型を同期する。
- credential、CSRF、Problem Details、idempotencyの扱いは共通clientに一元化する。
- server stateはcache lifecycleを明示し、loading、cached refetch、error、mutation後の関連resourceを区別する。
- HTTP errorは機械可読な分類を持ち、UIがretry、修正、権限不足、依存障害を区別できること。
- JSON mutationは同一操作のretryを冪等にし、処理中とpayload不一致を別の競合として扱う。
- request、response、exportは件数・byte数・複雑性の上限を持ち、上限超過を明示的に拒否する。

具体的な framework、API shape、status code、上限値は endpoint / source と runtime 設定を正本とする。

## 3. Asynchronous Processing

- OCR / 分析 job・request・入力と業務状態を同じ DB transaction で確定する。
- commit 後の wake は低遅延化の hint とし、startup / reconnect / deadline / 低頻度走査で欠落から回復する。
- scheduler は候補を上限付きで取得し、DB claim、lease、fence で競合を制御する。job lock は候補選択ではなく claim で、title state / 下書きから job の順に取得する。
- parent process が外部 I/O、lease、timeout、子 process、durable write を所有し、attempt child は bounded な candidate だけを返す。
- OCRと分析は各 Worker process の同時実行数を1件とし、CPU・メモリ予算を予約する。待機候補ではOCRを先に選び、実行中の分析は完了させる。詳細は各専門正本に従う。

## 4. Image / Object Lifecycle

- uploadは許可形式、byte数、寸法、実体、checksumを検証し、workerが取得後にもmetadataを再検証する。
- account別の未参照upload上限とstorage空き容量preflightを分け、並行retryでもquotaを超過しない。
- OCR受付、画像取得、object reconciliationの必須依存を確認できない場合はfail closedにする。
- 画像はOCR完了後も下書き確定または削除まで保持し、その後削除する。
- object writeとDB commitの片側成功、orphan、削除失敗、retry / cleanup競合をreconcilerが冪等に収束させる。
- object-backed uploadとreconcilerは同じrelease単位で有効化し、cleanupを実行できる構成を揃える。
- 画像実体、内部path、長寿命URL、credentialをDB、公開DTOへ置かない。
- 認証済み利用者は下書きに属する元画像をpreview / downloadできるが、件数・byte数・rateを上限化する。

## 5. Availability / Degradation

- APIとDBが利用可能なら、既存結果の閲覧と画像なしの手入力をOCR / object storage なしで継続できること。
- rate limiterは単一API processのメモリで保持する。再起動によるカウンタ初期化と、複数processでは上限を共有しない性質を前提とし、永続quotaやOCRの同時job上限はDBで別に守る。
- OCR受付、upload、source image取得は、必要なjob DB / storageを確認できなければ受付を停止する。
- dependency readiness、process liveness、機能応答、resource / performanceを別の健康状態として扱う。
- failure時も秘密情報を含まないProblem Detailsと安全な運用情報を返し、内部例外やprovider情報を公開しない。

## 6. Runtime / Release

- public runtimeはWeb静的配信、API、reverse proxyを一つのrelease artifactとして構成し、process lifecycleとgraceful shutdownを管理する。
- 公開listenerからAPI受信までのprotocol要件は、edge表示からの推測ではなく各hopの直接検証で確認する。
- Processing Workerは利用者向けHTTP入口を持たず、productionと同じOS isolation、cgroup、native dependencyで検証する。
- runtimeは最小権限で実行し、release imageに含める言語runtime、package manager、debuggerは実行に必要なものに限る。
- 後方互換なDB migrationはconsumerより先に適用する。旧新consumerを併存させる非互換な変更は段階migrationにし、非互換の一括切替を選んだ機能は公開停止中に保存状態と全consumerを揃える。対象機能の切替契約に従い、データ保全と復旧条件を確認してから再開する。
- release候補は一度だけbuildし、immutable identity / provenanceを後続gateとdeployで再利用する。
- rollbackは同じ承認・排他・provenance検証を通し、health、機能、性能回復を別々に確認する。
- secretはlocal、CI、productionの各secret storeで管理し、tracked fileやpublic docsへ置かない。

具体的なruntime構成、CI workflow、release commandは実装と[CI・リリース規約](../release.md)を正本とする。

## 7. Security / Abuse Resistance

- ログインは許可済みaccountに限定し、認証主体と試合参加者を分離する。
- sessionはserver sideで管理し、cookieのSecure / HttpOnly / SameSiteとCSRF防御を適用する。
- login、OAuth callback、upload、画像取得、JSON mutation、CSV / TSV exportをaccount / IP / operationの適切なscopeでrate limitする。
- 冪等keyと本文の照合条件を満たす再送はreplayとして扱い、新規操作用のrate / key上限の対象から除く。
- 受信処理の負荷制限と新規操作数の制限を分ける。認証済みreadと本文decode前のmutation試行は別の上限を持ち、入口では再送も数える。本人情報取得・logoutは専用枠を持つ。入口上限には通常の再試行に足りる余裕を持たせ、replayは冪等keyに加えて本文を照合してから許可する。
- exportはscope指定と全件を別のcostとして制限し、生成前後にrow / byte上限を検証する。同期上限を超える需要は認可・保持・再生成を設計した非同期処理として扱う。
- OAuth callbackはstateの使用をPostgreSQLで原子的に確定してからproviderを呼ぶ。同じstateの再利用は有効期間全体で拒否し、DBへ記録できなければログインを中止する。provider障害はエラーとして返し、後続の新しいログインは入口のrate limitに従う。
- secret、session / CSRF / OAuth token、接続URL、画像内容、OCR raw text、分析成果物本文、例外全文をlog / responseへ出さない。
- security gateはedge policyと認証要件を保ったまま通す。

上限値と failure threshold には通常利用に足りる余裕を持たせ、runtime 設定を正本とし、境界値の検証で確認する。

## 8. Observability / Recovery

- production logはstructured eventとし、相関ID、分類、件数、byte数、処理時間、状態遷移を必要最小限で記録する。
- stream responseはhandler完了と転送完了を分け、body終了時にsuccess / error / cancelと実転送byte数をexactly once記録する。
- DB の job / request / artifact、Worker heartbeat、実行待ち、resource を別々に観測する。job の成否は起床通知の有無ではなく DB の状態で判断する。
- public healthは粗いstatus / reasonに限定し、内部件数や攻撃面を公開しない。詳細は管理下のlog / metric / DBで確認する。
- metric labelは低cardinalityの値に限り、account、job、作品などの識別は安全なopaque IDでlog相関する。
- DB backup / restoreはDB providerの機能を利用し、復旧可能性を定期的に確認する。アプリの削除確認とprovider backupは別のものとして扱う。
- 外部監視、provider dashboard、alert threshold、個別障害対応はprivate運用文書で管理する。
- 外部のエラー追跡・分散trace・ログ集約は、既存の構造化ログで原因特定が継続的に難しい場合に導入を検討する。APIとWorkerのrequest / jobを横断して追え、固定4名の運用規模に見合う費用であることを条件とする。送信対象から7節の機密情報を除き、収集・送信が失敗してもアプリの起動とOCR処理を継続できること。

## 9. Performance / Client Quality

- 通常画面 / APIは体感1秒以内、同期CSV / TSV exportは数秒以内を目標とする。利用者の待ち方を判断する目安であり、測定条件のない厳密なSLOや使いやすさ全体の合格点として扱わない。具体的な遅さを調べる場合は対象の操作・負荷・環境を定めて測定し、操作の継続性や負担も確認する。
- OCRは非同期とし、timeout / retry / lease 回復は実測とjob lifecycleに基づいて調整する。
- 戦績比較は保存済みartifactだけを読み、worker、API decode / response、browser parse / renderを別々に測定する。
- 戦績分析のfixture、連続実行、timeout、resource条件は`docs/requirements/series-analysis-batch.md`を正本とする。
- target OS / architecture上のruntime imageでmemory hard limit、peak headroom、OOM、shutdown、主要E2Eを検証する。
- 最新安定版のChrome、Firefox、Safari、Edgeを対象とし、通常操作はmobileでも成立させる。
- keyboard、label、focus、contrast、status announcementはWCAG AA相当を最低水準とする。画像upload / exportはPC主対象としてよいが、意味と安全性はdevice間で揃える。

## 10. Acceptance Criteria

本節に対する evidence の選定と実行は [文書索引の「変更対象から読む」](../README.md#変更対象から読む)の順序に従う。

| 変更境界 | 受入に必要な観測 |
| --- | --- |
| Web / API contract | Tapir endpoint、生成 artifact、Web consumer が同じ契約を表し、代表 user flow の request / response が意図した結果へ到達する |
| DB / job / object | migration 適用済みの production boundary で transaction、recovery、wire の意味が保たれる |
| worker / native / isolation | production 相当 image で native dependency、process / cgroup、timeout、待機優先と実行継続の契約が成立する |
| runtime / protocol | 配置対象 image が各 hop の protocol、health、shutdown、主要 user flow を保ち、既知の重大な image 脆弱性を含まない |
| security / limits | boundary、concurrency、retry、dependency failure が安全に失敗し、secret を露出しない |
| performance | production 相当 resource で代表・上限・連続実行時の process 別 memory / latency 要求を満たす |
| release / rollback | 同じ immutable candidate と provenance を通常 deploy / rollback の双方で検証し、対象世代を復元できる |

外部境界を未実行またはskipした場合は、その挙動を未検証として報告する。
