# 桃鉄結果記録・集計アプリ 技術構成・非機能要件

目的: `docs/requirements/base.md` の業務要求を実現する技術構成と、可用性、セキュリティ、性能、運用上の達成条件を定義する。

専門正本:

- 実装境界: `docs/architecture.md`
- DB / migration: `docs/db-rule.md`
- OCR queue: `docs/redis-streams-ocr-contract.md`
- 戦績分析: `docs/requirements/series-analysis-batch.md`
- UI / test / command: `docs/ui-rule.md`、`docs/test-rule.md`、`docs/dev-rule.md`

現在のframework version、directory、env名、threshold、workflow、provider設定は実装・設定を正本とし、この文書へ複製しない。

## 1. System Boundaries

- Web、API、Processing Worker、共有DB、queue、object storageを独立した責務として扱う。
- WebとAPIだけが利用者向けHTTP runtimeを構成する。OCRと戦績分析は高負荷処理がHTTP可用性を巻き込まない独立Rust runtimeへ置く。
- APIは認証、入力検証、業務usecase、保存済み状態の読み取りを担う。OCR / 分析engineをHTTP request内で実行しない。
- DBはsummitと共有するPostgreSQLを使い、schema / migrationは`../momo-db`が所有する。
- Redis StreamsはOCR / 分析jobの少なくとも1回の配送に使い、状態の正本にしない。
- upload画像は非公開object storageへ置き、DB / queueにはopaque keyと検証metadataだけを保存する。
- provider固有のtopology、resource、費用、実測、復旧手順はprivateに置く。

## 2. Web / API Contract

- WebはSPAとし、画面固有状態とserver stateを分離する。accessibility primitive、shared UI、semantic tokenを共通化する。
- client / serverの両方で入力を検証し、workflow identifierやmode discriminatorを変換で失わない。
- APIのwire契約はendpoint定義を正本とし、OpenAPIとWeb生成型を同期する。
- 共通clientがcredential、CSRF、Problem Details、idempotencyを扱い、featureごとに再実装しない。
- server stateはcache lifecycleを明示し、loading、cached refetch、error、mutation後の関連resourceを区別する。
- HTTP errorは機械可読な分類を持ち、UIがretry、修正、権限不足、依存障害を区別できること。
- JSON mutationは同一操作のretryを冪等にし、処理中とpayload不一致を別の競合として扱う。
- request、response、exportは件数・byte数・複雑性の上限を持ち、上限超過を明示的に拒否する。

具体的な framework、API shape、status code、上限値は endpoint / source と runtime 設定を正本とする。

## 3. Asynchronous Processing

- OCR / 分析job、outbox、業務状態は同じDB transactionでdurableに確定し、Redis publishを業務transactionの成功条件にしない。
- commit後のwakeは低遅延化のhintとし、startup / bounded recoveryで失われたwakeや重複deliveryから回復する。
- dispatcherはidle時に短周期pollingせず、wake、deadline、低頻度recoveryで動く。
- terminal DB write前にdeliveryをACKしない。重複deliveryはDB claim、lease、fence、terminal状態で冪等に収束させる。
- parent processが外部I/O、lease、timeout、子process、durable write、ACKを所有し、attempt childはboundedで非authoritativeなcandidateだけを返す。
- OCRと分析は共有実行枠を1件とし、OCRだけが分析をpreemptできる。詳細は各専門正本に従う。

## 4. Image / Object Lifecycle

- uploadは許可形式、byte数、寸法、実体、checksumを検証し、workerが取得後にもmetadataを再検証する。
- account別の未参照upload上限とstorage空き容量preflightを分け、並行retryでもquotaを超過しない。
- OCR受付、画像取得、object reconciliationの必須依存を確認できない場合はfail closedにする。
- 画像は下書き確定または削除まで保持し、その後削除する。OCR完了だけでは削除しない。
- object writeとDB commitの片側成功、orphan、削除失敗、retry / cleanup競合をreconcilerが冪等に収束させる。
- object-backed uploadとreconcilerは同じrelease単位で有効化し、cleanup不能な部分切替をしない。
- 画像実体、内部path、長寿命URL、credentialをDB、queue、公開DTOへ置かない。
- 認証済み利用者は下書きに属する元画像をpreview / downloadできるが、件数・byte数・rateを上限化する。

## 5. Availability / Degradation

- APIとDBが利用可能なら、既存結果の閲覧と画像なしの手入力をOCR / queue / object storageなしで継続できること。
- 共有rate limiter障害時、通常read / mutationは短いtimeout後に同じ設定上限のprocess-local limiterへ縮退できる。ただし分散上限からinstance単位へ弱まった状態を観測可能にする。
- OCR受付、upload、source image取得はlocal fallbackの対象にせず、queue / storageを確認できなければ受付を停止する。
- dependency readiness、process liveness、機能応答、resource / performanceを別の健康状態として扱う。
- failure時も秘密情報を含まないProblem Detailsと安全な運用情報を返し、内部例外やprovider情報を公開しない。

## 6. Runtime / Release

- public runtimeはWeb静的配信、API、reverse proxyを一つのrelease artifactとして構成し、process lifecycleとgraceful shutdownを管理する。
- 公開listenerからAPI受信までのprotocol要件は各hopを直接検証し、edge表示から内部hopを推測しない。
- Processing Workerは利用者向けHTTP入口を持たず、productionと同じOS isolation、cgroup、native dependencyで検証する。
- runtimeは最小権限で実行し、不要な言語runtime、package manager、debuggerをrelease imageへ含めない。
- DB migrationはconsumerより先に適用し、破壊的変更は旧新consumerの共存期間を持つ段階migrationにする。
- release候補は一度だけbuildし、immutable identity / provenanceを後続gateとdeployで再利用する。
- rollbackは同じ承認・排他・provenance検証を通し、health、機能、性能回復を別々に確認する。
- secretはlocal、CI、productionの各secret storeで管理し、tracked fileやpublic docsへ置かない。

具体的なruntime構成、CI workflow、release commandは実装と`docs/dev-rule.md`を正本とする。

## 7. Security / Abuse Resistance

- ログインは許可済みaccountに限定し、認証主体と試合参加者を分離する。
- sessionはserver sideで管理し、cookieのSecure / HttpOnly / SameSiteとCSRF防御を適用する。
- login、OAuth callback、upload、画像取得、JSON mutation、CSV / TSV exportをaccount / IP / operationの適切なscopeでrate limitする。
- retry済みidempotent operationを新規操作と同じrate / key上限で誤拒否しない。
- exportはscope指定と全件を別のcostとして制限し、生成前後にrow / byte上限を検証する。同期上限を超える需要は認可・保持・再生成を設計した非同期処理として扱う。
- provider連続障害はbounded backoffし、callback replayをprovider呼出し前に抑止する。
- secret、session / CSRF / OAuth token、接続URL、画像内容、OCR raw text、分析成果物本文、例外全文をlog / responseへ出さない。
- security gateを通すためにedge policyや認証要件を弱めない。

上限値と failure threshold は通常利用を妨げない余裕を持たせ、runtime 設定を正本とし、境界値の検証で確認する。

## 8. Observability / Recovery

- production logはstructured eventとし、相関ID、分類、件数、byte数、処理時間、状態遷移を必要最小限で記録する。
- stream responseはhandler完了と転送完了を分け、body終了時にsuccess / error / cancelと実転送byte数をexactly once記録する。
- DBのjob / outbox / artifact、Redis stream / PEL / DLQ、worker heartbeat、queue待機、resourceを別々に観測し、transportから業務状態を推測しない。
- public healthは粗いstatus / reasonに限定し、内部件数や攻撃面を公開しない。詳細は管理下のlog / metric / DBで確認する。
- metric labelにaccount、job、作品など高cardinality IDを入れず、安全なopaque IDでlog相関する。
- DB backup / restoreはDB providerの機能を利用し、復旧可能性を定期的に確認する。アプリの削除確認とprovider backupを混同しない。
- 外部監視、provider dashboard、alert threshold、個別障害対応はprivate運用文書で管理する。

## 9. Performance / Client Quality

- 通常画面 / APIは体感1秒以内、同期CSV / TSV exportは数秒以内を目標とする。
- OCRは非同期とし、timeout / retry / DLQは実測とjob lifecycleに基づいて調整する。
- 戦績比較は保存済みartifactだけを読み、worker、API decode / response、browser parse / renderを別々に測定する。
- 戦績分析のfixture、連続実行、timeout、resource条件は`docs/requirements/series-analysis-batch.md`を正本とする。
- target OS / architecture上のruntime imageでmemory hard limit、peak headroom、OOM、shutdown、主要E2Eを検証する。
- 最新安定版のChrome、Firefox、Safari、Edgeを対象とし、通常操作はmobileでも破綻させない。
- keyboard、label、focus、contrastを含むWCAG AA相当を目標にする。画像upload / exportはPC主対象としてよいが、意味と安全性をdevice間で変えない。

## 10. Acceptance Criteria

本節に対する evidence の選定と実行は `docs/README.md` 1節の順序に従う。

| 変更境界 | 受入に必要な観測 |
| --- | --- |
| Web / API contract | Tapir endpoint、生成 artifact、Web consumer が同じ契約を表し、代表 user flow の request / response が意図した結果へ到達する |
| DB / queue / object | migration 適用済みの production boundary で transaction、recovery、wire の意味が保たれる |
| worker / native / isolation | production 相当 image で native dependency、process / cgroup、timeout、preemption の契約が成立する |
| runtime / protocol | 配置対象 image が各 hop の protocol、health、shutdown、主要 user flow を保ち、既知の重大な image 脆弱性を含まない |
| security / limits | boundary、concurrency、retry、dependency failure が安全に失敗し、secret を露出しない |
| performance | production 相当 resource で代表・上限・連続実行時の process 別 memory / latency 要求を満たす |
| release / rollback | 同じ immutable candidate と provenance を通常 deploy / rollback の双方で検証し、対象世代を復元できる |

外部境界を未実行またはskipした場合は、その挙動を未検証として報告する。
