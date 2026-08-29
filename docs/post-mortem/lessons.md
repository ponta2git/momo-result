# Postmortem Lessons

この文書は、作業完了前に見落としやすい重要事項だけを反芻するための最終チェックリストである。
実装規約・設計規約・契約仕様の正本ではない。
public repository に置くため、具体的な障害位置、再現手順、endpoint / component 名、時系列詳細は含めない。
個別の詳細記録は `private/post-mortem/` に置き、ユーザーが明示した場合だけ読む。

恒久ルールは次へ置く。

- 業務要件・CSV/TSV: `docs/requirements/base.md`
- 技術構成・API / Web / Processing Worker runtime実装規約: `docs/architecture.md`
- ドメイン用語・状態遷移: `docs/domain-rule.md`
- DB共有・migration: `docs/db-rule.md`
- Redis Streams / OCR queue 契約: `docs/redis-streams-ocr-contract.md`
- evidence の選択・oracle: `docs/test-rule.md`
- test size・parallelism・coverage・CI artifact: `docs/test-architecture.md`
- quality gate・検証コマンド: `docs/dev-rule.md`

## 使い方

1. 変更対象に一致するカードだけ読む。
2. 各カードの「確認」を、作業計画・実装・テスト選択のいずれかへ反映する。
3. 判断に迷う場合は「参照先」の正本文書を読む。
4. 検証できない項目が残る場合は、最終報告で未検証として明記する。

該当しないカードを無理に適用しない。ただし、なぜ該当しないかを説明できる状態にしておく。

## 教訓カード

### L1 DB-backed API は実DBで壊れる

**該当条件**

- `apps/api` の repository / Doobie query / usecase transaction / DB前提を変更する。
- migration、table、column、FK、seed、SQLSTATE、PostgreSQL runtime error、pooler / proxy経由の接続設定に関係する。

**確認**

- 接続先DBに必要な migration が適用済みか。
- 変更した SQL / repository を実PostgreSQLで実行したか。
- 同一 transaction で FK 関連 row を作成・更新する場合、statement order と保存後の linked row values を integration test で確認したか。
- DB contract、repository integration、HTTP/usecase test の責務を混同していないか。
- DB / integration test が skip された場合、その挙動を未検証として扱ったか。
- 直接接続したPostgreSQLの成功を、pooler / proxyのstartup parameterやsession state互換性の証拠にしていないか。
- release probeのtimeoutを接続後transaction内へ閉じ、production互換のread-only経路で確認したか。

**参照先**

- `docs/db-rule.md`
- `docs/test-rule.md` の API Evidence Catalog / DB-backed API
- `docs/dev-rule.md`

### L2 テストは失敗した実行経路を直接通す

**該当条件**

- テスト追加・修正を伴う。
- 「どのテストを走らせれば十分か」を判断する。
- 近い層のテストで、別の層の不具合を代用検証しようとしている。
- health checkや外形監視の観測地点、送信元、edge経路を変更する。

**確認**

- 報告された endpoint、query、UI操作、usecase 分岐そのものを通したか。
- レイヤごとの責務を分け、隣接テストの成功を該当経路の成功として扱っていないか。
- 外部依存の検証が skip / 未実行なら、その挙動を未検証として報告する準備があるか。
- edge policyに拒否される観測地点をblocking oracleにせず、意図した公開経路を通る管理下の地点で確認したか。
- gateを通すためにsecurity policyを弱めたり、拒否responseを成功扱いしたりしていないか。

**参照先**

- `docs/test-rule.md`
- `docs/dev-rule.md`

### L3 TanStack Query は cache lifecycle で壊れる

**該当条件**

- `apps/web` の `queryKey`、`queryFn`、API wrapper、ViewModel変換、query error表示、mutation後のcache反映を変更する。
- 同じ backend resource を複数画面・複数 feature から読む。

**確認**

- `query.error` / `isError` だけで現在の致命的失敗として表示していないか。
- 認証、`enabled`、`isFetching` / `fetchStatus`、refetch success、cached error の lifecycle を考慮したか。
- `queryKey` は backend resource 名だけでなく、cache に保存する runtime data shape を表しているか。
- mutation 成功後、選択値だけでなく候補 list/select の cache も整合しているか。

**参照先**

- `docs/architecture.md` の Server State
- `docs/test-rule.md` の Query / API Error

### L4 Form / request transform は workflow identifier を落とす

**該当条件**

- form、filter、select、input、button の handler を変更する。
- Zod schema、フォーム値から API request への変換、mutation payload を変更する。
- optional field の有無で endpoint / usecase の mode や副作用が変わる。

**確認**

- React event 由来の値を handler 内で同期的に退避したか。
- Testing Library + user-event で、報告された操作または変更した操作そのものを実行したか。
- route param、prefill、hidden state 由来の workflow identifier が schema parse / transform 後の request body に残るか。
- optional field を mode discriminator として扱い、各 mode の payload と副作用を確認したか。
- 同一 component 内に同種の handler / state updater pattern が残っていないか。

**参照先**

- `docs/architecture.md` の Form / React 19 / API Client
- `docs/domain-rule.md` の Draft / Match Confirmation Modes
- `docs/test-rule.md` の Form / Interaction

### L5 Test double と oracle は通るだけのテストを作る

**該当条件**

- `*.test.ts(x)`、MSW handler、fixture、test factory、DOM API mock、`vi.spyOn`、module-scope store を変更する。
- assertion が「存在する」「crashしない」程度に留まりそうである。

**確認**

- oracle は role / name / value / state / request body / response shape など、壊れ方を捕まえる具体性を持つか。
- module-scope store、mock、storage、timer の後片付けは共通 setup または test lifecycle に集約されているか。
- 非同期待ちは実時間 delay ではなく、MSW / Promise / timer を決定論的に制御しているか。
- `as unknown as` や inline payload 量産で、型契約や fixture 管理を回避していないか。

**参照先**

- `docs/test-rule.md` の Test Foundation / Doubles と Coverage / Decision Coverage
- `docs/architecture.md` の Web
- `apps/web/src/test/factories/`
- `apps/web/src/test/msw/handlers.ts` の `resetMswStores`

### L6 React 新APIは既存契約を置き換えすぎる

**該当条件**

- React 19 API、Suspense、`use(promise)`、`useActionState`、`useFormStatus`、`useOptimistic`、`<Activity>` を導入・変更する。
- TanStack Query、フォーム、ルーティング、状態管理を置き換える可能性がある。

**確認**

- 採用目的は「新しいから」ではなく、既存経路より複雑さ・不具合面を減らすことか。
- TanStack Query が担う cache、dedup、retry、認証・エラー正規化を失っていないか。
- pending / optimistic state は API 制約に合った境界で扱っているか。
- 採用しない判断をした場合も、根拠を短く残したか。

**参照先**

- `docs/architecture.md` の Server State と Form / React 19 / API Client
- `docs/test-rule.md` の Query / API Error、Form / Interaction、Locator / E2E

### L7 契約変更はコードだけでは伝わらない

**該当条件**

- endpoint mode、optional discriminator、queue payload、OCR対象画面種別、DB状態遷移、外部境界の wire value を追加・変更する。
- 生成 OpenAPI / schema / 型だけで意味論を表したつもりになっている。

**確認**

- 実装前に読むべき意味論は、要件・ドメイン・アーキテクチャ・DB・Redis契約のいずれかへ置いたか。
- mode discriminator と副作用は、field の存在だけでなく文章で説明されているか。
- 外部境界を変えた場合、生成物を更新し、`docs/test-rule.md` で選んだ contract / integration evidence が変更した意味を観測できるか。
- `lessons.md` に恒久ルールを書き足して終わらせていないか。

**参照先**

- `docs/requirements/base.md`
- `docs/domain-rule.md`
- `docs/architecture.md`
- `docs/db-rule.md`
- `docs/redis-streams-ocr-contract.md`
- `docs/test-rule.md`

### L8 高負荷分析は通常経路のコストと観測を先に固定する

**該当条件**

- 集計、推薦、モデル計算、ドリルダウンなど、1つの画面表示から複数の読み取り経路が動く。
- 高度な分析や派生カードを、通常の表示経路へ追加・接続する。
- 非同期成果物、job状態、計算version、resource上限、timeoutを変更する。

**確認**

- 読み取りAPIが保存済み成果物だけを読み、HTTP request内で分析engineを実行しないことを確認したか。
- 1作品の全スコープ、通常集計、振り返り、ドリルダウン間で重い計算を再利用しているか。
- 計算中・失敗時に部分成果物を公開せず、直前成功成果物と状態を表示できるか。
- 代表データ量、連続実行、処理時間、peak memory、timeoutの予算を本番同等runtimeで測定したか。
- workerを軽量化した結果、APIが作品成果物全体をdecodeしたり、browserへ巨大responseを渡したりして
  resource負荷を別processへ移していないか。
- 同時実行数1をruntime台数だけで推測せず、deploy重複とlease失効後の旧processをDB fenceで拒否できるか。
- pipeline成功、health check、機能応答、CPU / latency観測を別々の証拠として扱ったか。
- algorithm version変更を定数とworker imageの更新だけで完了扱いせず、対応reader / worker、desired version昇格、
  queued jobの収束、非対応deliveryの観測を別々に確認したか。
- fresh DBのrelease singletonをfixtureで変更する前に、algorithm / artifact schema / validation contractの
  exact tupleを確認し、promotion済みDBやtest内の明示UPDATEで代用していないか。
- 性能観測ができない状態なら、配置成功までを確認済み、性能回復は未検証として報告したか。
- rollback時は表示名ではなく、影響を受けた全実行経路を覆う差分か確認したか。

**参照先**

- `docs/requirements/series-comparison.md` の Read / Failure Behavior
- `docs/requirements/series-analysis-batch.md` の Correctness / Resource / OCR
- `docs/requirements/series-review-playbook.md` の Detail / Artifact Boundary
- `docs/test-rule.md` の Performance-sensitive Analytics
- `docs/dev-rule.md` の Production rollback verification

### L9 Release来歴の外部wire表現を推測しない

**該当条件**

- CI actionやprovider APIの出力を、artifact identity、digest、provenance、promotion条件へ取り込む。
- producerとconsumerを別workflowに分け、mockや手書きfixtureで来歴契約を検証する。

**確認**

- 外部wire値を境界で検証・正規化し、内部表現を一意にしたか。
- fixtureは公開契約の実際の型・形式を表し、都合のよい接頭辞や型を仮定していないか。
- producerの正規化結果をconsumer validatorへ渡すことを、選択した contract evidence で観測できるか。
- 候補生成の成功だけで昇格可能と判断せず、本番変更前の来歴解決がfail-closedで完走するか。
- 部分再実行でproducer attemptとconsumer attemptが異なる場合も、候補identityをcurrent attemptから再計算せず、実artifact IDとsource attemptを保持したか。
- release evidenceやhealth checkを変更したとき、通常deploy、再実行、rollbackなど全consumerを列挙し、現在世代と旧target世代の両方を直接通したか。

**参照先**

- `docs/dev-rule.md` の CI Gates / Release
- `docs/test-rule.md` の External Service Evidence Catalog

### L10 開発hostで通ることをproduction runtimeの証拠にしない

**該当条件**

- `cfg(target_os)`、native library、container内だけのdependencyを変更する。
- production用のDB-backed adapterと、local / E2E用adapterが同じusecaseへ接続される。
- retryするE2Eが、前attemptと同じDBやfixture領域を使う。

**確認**

- production target OSで、必要なnative dependencyを明示したlint / build / testを通したか。
- local adapterもproductionと同じDB row、object key、状態遷移の不変条件を満たすか。
- retry後に前attemptのfixtureが残っても、test-owned IDで正しいresourceだけを操作するか。
- release gateの失敗を個別に迂回せず、検出した契約差を `docs/test-rule.md` で再評価し、採用した回帰 evidence がその差を直接観測するか。

**参照先**

- `docs/architecture.md` の OCR Capability / Worker Role
- `docs/test-rule.md` の Locator / E2E、DB-backed API、Analysis Capability / Worker Evidence Catalog

### L11 共有credentialのrotationは既存connectionが不整合を隠す

**該当条件**

- 複数のservice / workerが同じcredentialまたは同時に変わるcredential群を使う。
- provider側でcredentialを更新し、各consumerのsecret storeを個別に更新する。
- healthや稼働時間が、rotation前から維持されたconnectionに依存し得る。

**確認**

- 更新前に全consumer、secret store、read / write roleを列挙し、同じ保守単位のchecklistへ固定したか。
- 各consumerが対象世代固有のidentityで新規接続し、必要なruntime peerがすべてreadyになったか。
- processのstarted、既存connectionの継続、別consumerの成功をcredential整合の証拠にしていないか。
- rotation後の再起動やconnection recycleが失敗した場合、release gateが成功扱いせず停止するか。

**参照先**

- `docs/dev-rule.md` の CI Gates / Release
- `docs/test-rule.md` の External Service Evidence Catalog

### L12 source の token を production asset に存在するとみなさない

**該当条件**

- runtime の値から CSS token、custom property、utility class などの識別子を組み立てる。
- source detection、tree-shaking、minification で未使用 output を除く build tool を使う。
- stylesheet の定義、unit test、development 表示を production build の証拠にしようとしている。

**確認**

- consumer が必要とする識別子が、変換後の production asset にすべて残ることを直接確認したか。
- source 上の定義や文字列 mapping の成功を、最終 CSS と browser paint の成功として扱っていないか。
- build checker を置く場合、canonical build と container build の両方が同じ checker と入力を使うか。
- browser evidence は exact 色値や DOM 構造ではなく、定義済み paint、系列の識別可能性、非色 signifier を観測しているか。

**参照先**

- `docs/test-rule.md` の UI Conformance
- `docs/dev-rule.md` の Change Gates
- `docs/ui-rule.md` の「検証」

### L13 Shared DB migration は owner の authoring 手順から始める

**該当条件**

- `../momo-db` のschema、migration、Drizzle設定・script、またはmigration stateを変更する。
- `momo-result`や`summit`から共有DBの変更を依頼・実装する。

**確認**

- file編集やDB操作より先に`../momo-db/docs/development.md`を全文確認したか。
- schema宣言から生成するmigrationと、function、trigger、precondition、backfill用のcustom migrationを
  正規commandで分け、journal / snapshotの採番を手で操作していないか。
- 対象migrationの適用状態を確認し、保存対象DBをfresh検証へ流用せず、existing DBのdata保持を別に
  確認したか。
- custom migration内の手書きSQLを一律禁止するのではなく、Drizzle管理下の履歴・順序・検証へ閉じたか。

**参照先**

- `AGENTS.md`
- `docs/db-rule.md`
- `../momo-db/AGENTS.md`
- `../momo-db/docs/development.md`

## 更新ルール

- 新しい教訓を追加する前に、恒久ルールとして移すべき内容がないか確認する。
- このファイルに残すのは「いつ思い出すか」「何を問い直すか」「どこを見るか」だけにする。
- 事故固有の経緯、影響、残リスクは個別ポストモーテムへ置く。

## 最終報告

該当するカードがあった場合、最終報告では次を短く述べる。

- どのカードが該当したか。
- どの正本文書に従ったか。
- どの evidence・コマンドで検証したか。
- 未検証の外部依存・DB/integration 経路・残リスクがあるか。
