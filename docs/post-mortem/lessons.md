# Postmortem Lessons

変更に該当する失敗の見落としを、設計や検証を選ぶ時に思い出すためのカード集である。恒久ルールの置き場とカードの増減の基準は [文書索引](../README.md#文書の増減と保守)、公開範囲と個別記録の扱いは [Public Postmortem Policy](README.md) に従う。

## 使い方

下表から該当カードの条件・確認事項を読む。確認事項は見落としを問い直す観点として使い、test・gate の要否と品質の判断は参照先の正本で行う。契約は参照先の正本、証拠の採否は [テスト・品質規約](../test-rule.md)、検証の終了は [Change Gates](../dev-rule.md#change-gates) に従う。実装・検証へ反映済みの確認は再利用し、関連する変更や未解決事項が生じた範囲を見直す。教訓の確認によって選んだ実装・検証・制約は通常の変更報告へ含め、カード番号は判断の根拠を伝えるために必要な場合に示す。

| 変更・判断 | カード |
| --- | --- |
| DB query / transaction / 接続 | [L1](#l1-db-backed-api-は実dbで壊れる) |
| 品質証拠の選択 / test double / oracle | [L2](#l2-テストは失敗した実行経路を直接通す)、[L5](#l5-test-double-と-oracle-は通るだけのテストを作る) |
| Web cache / form / request 変換 / React API | [L3](#l3-tanstack-query-は-cache-lifecycle-で壊れる)、[L4](#l4-form--request-transform-は-workflow-identifier-を落とす)、[L6](#l6-react-新apiは既存契約を置き換えすぎる) |
| 契約や意味論の記述 | [L7](#l7-契約変更はコードだけでは伝わらない) |
| 分析の読み取り経路 / job 状態 / lease / resource / timeout | [L8](#l8-高負荷分析は通常経路のコストと観測を先に固定する) |
| algorithm version / release singleton / rollback | [L14](#l14-algorithm-version-と-release-世代は定数更新で完了しない)（deploy 重複・旧 process の fence は [L8](#l8-高負荷分析は通常経路のコストと観測を先に固定する)） |
| CI / release 来歴 / 外部 wire | [L9](#l9-release来歴の外部wire表現を推測しない) |
| production OS / native dependency / adapter / E2E retry | [L10](#l10-開発hostで通ることをproduction-runtimeの証拠にしない) |
| 共有 credential の rotation | [L11](#l11-共有credentialのrotationは既存connectionが不整合を隠す) |
| 動的な識別子と production asset | [L12](#l12-source-の-token-を-production-asset-に存在するとみなさない) |
| momo-db の schema / migration / Drizzle / migration state | [L13](#l13-shared-db-migration-は-owner-の-authoring-手順から始める) |

## 教訓カード

### L1 DB-backed API は実DBで壊れる

**該当条件**

- `apps/api` の repository / query / usecase transaction / DB 前提を変更する。
- migration、table、column、FK、seed、SQLSTATE、PostgreSQL runtime error、pooler / proxy 経由の接続設定に関係する。

**確認**

- 接続先 DB に必要な migration が適用済みか。
- 変更した SQL / repository を実 PostgreSQL で実行したか。
- 同一 transaction で FK 関連 row を作成・更新する場合、statement order と保存後の linked row values を integration test で確認したか。
- pooler / proxy の startup parameter や session state 互換性を確認済みとする場合、その経路を通した証拠で判断したか。
- DB / integration test が skip された場合、その挙動を未検証として扱ったか。

**参照先**

- [DB 規約の Contract Evidence](../db-rule.md#contract-evidence)
- [テスト・品質規約の DB-backed API](../test-rule.md#db-backed-api)

### L2 テストは失敗した実行経路を直接通す

**該当条件**

- テスト追加・修正を伴う、または「どのテストを走らせれば十分か」を判断する。
- 近い層のテストで、別の層の不具合を代用検証しようとしている。
- health check や外形監視の観測地点、送信元、edge 経路を変更する。

**確認**

- 報告された endpoint、query、UI 操作、usecase 分岐そのものを通したか。
- 該当経路の成功を、隣接テストではなくその経路の結果で判断したか。
- 外部依存の検証が skip / 未実行なら、その挙動を未検証として報告する準備があるか。
- blocking oracle を、edge policy に拒否されない、意図した公開経路を通る管理下の地点に置いたか。security policy を保ったまま gate を通し、拒否 response を拒否として分類し、公開経路の成功とは区別したか。

**参照先**

- [テスト・品質規約](../test-rule.md#証拠モデルと正本)
- [CI・リリース規約](../release.md#ci-classification-and-evidence)

### L3 TanStack Query は cache lifecycle で壊れる

**該当条件**

- `apps/web` の `queryKey`、`queryFn`、API wrapper、ViewModel 変換、query error 表示、mutation 後の cache 反映を変更する。
- 同じ backend resource を複数画面・複数 feature から読む。

**確認**

- cached error を保った再取得、認証待ち、disabled query を、現在の致命的失敗とは別の状態として表示しているか。
- `queryKey` は backend resource 名だけでなく、cache に保存する runtime data shape を表しているか。
- mutation 成功後、選択値だけでなく候補 list / select の cache も整合しているか。

**参照先**

- [Web 実装規約の Server State](../web-rule.md#server-state)
- [テスト・品質規約の Query / API Error](../test-rule.md#query--api-error)

### L4 Form / request transform は workflow identifier を落とす

**該当条件**

- フォーム値から API request への変換、validation schema、mutation payload を変更する。
- optional field の有無で endpoint / usecase の mode や副作用が変わる。

**確認**

- 報告された操作または変更した操作そのものを実操作で通したか。
- route param、prefill、hidden state 由来の workflow identifier が schema parse / transform 後の request body に残るか。
- optional field を mode discriminator として扱い、各 mode の payload と副作用を確認したか。

**参照先**

- [Web 実装規約の Form / React 19 / API Client](../web-rule.md#form--react-19--api-client)
- [ドメイン規約の Draft / Match Confirmation Modes](../domain-rule.md#draft--match-confirmation-modes)
- [テスト・品質規約の Form / Interaction](../test-rule.md#form--interaction)

### L5 Test double と oracle は通るだけのテストを作る

**該当条件**

- `*.test.ts(x)`、MSW handler、fixture、test factory、DOM API mock、`vi.spyOn`、module-scope store を変更する。
- assertion が「存在する」「crash しない」程度に留まりそうである。

**確認**

- 「存在する」「crash しない」だけでは守る結果を判定できない場合、壊れ方を捕まえる値・状態・request body を観測しているか。存在や無停止そのものが利用者契約なら、それを主 oracle にしてよい。
- module-scope store、mock、storage、timer の後片付けは共通 setup または test lifecycle に集約されているか。
- fixture を意味のある factory で管理し、`as unknown as` や inline payload の量産に頼らず型契約を保っているか。

**参照先**

- [テスト・品質規約の Test Foundation / Doubles](../test-rule.md#test-foundation--doubles) と [Coverage / Decision Coverage](../test-rule.md#coverage--decision-coverage)
- [Web 実装規約の Implementation Entry Points](../web-rule.md#implementation-entry-points)（共通 factory と MSW reset）

### L6 React 新APIは既存契約を置き換えすぎる

**該当条件**

- React 19 API、Suspense、`use(promise)`、`useActionState`、`useFormStatus`、`useOptimistic`、`<Activity>` を導入・変更する。
- TanStack Query、フォーム、ルーティング、状態管理を置き換える可能性がある。

**確認**

- 採用目的は「新しいから」ではなく、既存経路より複雑さ・不具合面を減らすことか。
- TanStack Query が担う cache、dedup、retry、認証・エラー正規化を維持しているか。
- pending / optimistic state は API 制約に合った境界で扱っているか。
- 採用・非採用が重要な設計判断となる場合、その理由を変更説明から追えるか。

**参照先**

- [Web 実装規約の Server State](../web-rule.md#server-state) と [React Update Priority](../web-rule.md#react-update-priority)
- [テスト・品質規約の Web Evidence Catalog](../test-rule.md#web-evidence-catalog)

### L7 契約変更はコードだけでは伝わらない

**該当条件**

- endpoint mode、optional discriminator、queue payload、OCR 対象画面種別、DB 状態遷移、外部境界の wire value を追加・変更する。
- 生成 OpenAPI / schema / 型だけで意味論を表したつもりになっている。

**確認**

- 実装前に読むべき意味論は、要件・ドメイン・API / Web / Worker 規約・DB・外部 I/O 契約のいずれかへ置いたか。
- mode discriminator と副作用は、field の存在だけでなく文章で説明されているか。
- 外部境界を変えた場合、生成物を更新し、選んだ contract / integration evidence が変更した意味を観測できるか。
- 恒久ルールを、本カード集ではなく専門正本へ置いたか。

**参照先**

- [文書索引の正本の役割](../README.md#正本の役割)
- [ドメイン規約](../domain-rule.md)、[API 規約](../api-rule.md#wire-boundary)、[DB 規約](../db-rule.md)、[OCR job 契約](../ocr-job-contract.md)

### L8 高負荷分析は通常経路のコストと観測を先に固定する

**該当条件**

- 集計、推薦、モデル計算、ドリルダウンなど、1つの画面表示から複数の読み取り経路が動く。
- 高度な分析や派生カードを、通常の表示経路へ追加・接続する。
- 非同期成果物、job 状態、lease、resource 上限、timeout を変更する。

**確認**

- 読み取り API が保存済み成果物だけを読み、分析 engine が HTTP request の外で動くことを確認したか。
- 1作品の全スコープ、通常集計、振り返り、ドリルダウン間で重い計算を再利用しているか。
- 計算中・失敗時も公開するのは完成した成果物だけとし、直前成功成果物と状態を表示できるか。
- deploy 重複や lease 失効後の旧 process からの durable 更新を DB fence で拒否できるか。Worker process ごとの同時実行数 1 は、lease 失効ではなく parent の資源予算と回収確認で守っているか。
- 代表データ量、連続実行、処理時間、peak memory、timeout の予算を本番同等 runtime で測定したか。worker を軽量化した結果、API が作品成果物全体を decode したり、browser へ巨大 response を渡したりして負荷を別 process へ移していないか。
- pipeline 成功、health check、機能応答、CPU / latency 観測を別々の証拠として扱い、性能観測ができない状態なら性能回復を未検証として報告したか。

**参照先**

- [比較要求の Read / Failure Behavior](../requirements/series-comparison.md#7-read--failure-behavior)
- [分析 batch 要求の Correctness / Resource / OCR](../requirements/series-analysis-batch.md#7-correctness--resource--ocr)
- [振り返り要求の Detail / Artifact Boundary](../requirements/series-review-playbook.md#6-detail--artifact-boundary)
- [テスト・品質規約の Performance-sensitive Analytics](../test-rule.md#performance-sensitive-analytics)
- fence と計算枠: [DB 規約の Locks and Transactions](../db-rule.md#locks-and-transactions)、[Worker 規約の Process Boundary](../worker-rule.md#process-boundary)

### L9 Release来歴の外部wire表現を推測しない

**該当条件**

- CI action や provider API の出力を、artifact identity、digest、provenance、promotion 条件へ取り込む。
- producer と consumer を別 workflow に分け、mock や手書き fixture で来歴契約を検証する。

**確認**

- 外部 wire 値を境界で検証・正規化し、内部表現を一意にしたか。
- fixture は、都合のよい接頭辞や型の仮定ではなく、公開契約の実際の型・形式を表しているか。
- producer の正規化結果を consumer validator へ渡すことを、選択した contract evidence で観測できるか。
- 昇格可否を、候補生成の成功に加えて、本番変更前の来歴解決が fail-closed で完走することで判断したか。
- 部分再実行で producer attempt と consumer attempt が異なる場合も、実 artifact ID と source attempt を保持し、候補 identity を current attempt ではなくそこから得たか。
- release evidence や health check を変更したとき、通常 deploy、再実行、rollback など全 consumer を列挙し、現在世代と旧 target 世代の両方を直接通したか。

**参照先**

- [CI・リリース規約](../release.md#release-candidate-and-provenance)
- [テスト・品質規約の External Service Evidence Catalog](../test-rule.md#external-service-evidence-catalog)

### L10 開発hostで通ることをproduction runtimeの証拠にしない

**該当条件**

- `cfg(target_os)`、native library、container 内だけの dependency を変更する。
- production 用の DB-backed adapter と、local / E2E 用 adapter が同じ usecase へ接続される。
- retry する E2E が、前 attempt と同じ DB や fixture 領域を使う。

**確認**

- production target OS で、必要な native dependency を明示した lint / build / test を通したか。
- local adapter も production と同じ DB row、object key、状態遷移の不変条件を満たすか。
- retry 後に前 attempt の fixture が残っても、test-owned ID で正しい resource だけを操作するか。
- release gate が失敗したら、個別の迂回ではなく検出した契約差の再評価で対応し、採用した回帰 evidence がその差を直接観測するか。

**参照先**

- [Worker 規約の OCR Capability](../worker-rule.md#ocr-capability)
- [テスト・品質規約の Locator / E2E](../test-rule.md#locator--e2e)、[DB-backed API](../test-rule.md#db-backed-api)、[Analysis Capability / Worker Evidence Catalog](../test-rule.md#analysis-capability--worker-evidence-catalog)

### L11 共有credentialのrotationは既存connectionが不整合を隠す

**該当条件**

- 複数の service / worker が同じ credential または同時に変わる credential 群を使う。
- provider 側で credential を更新し、各 consumer の secret store を個別に更新する。
- health や稼働時間が、rotation 前から維持された connection に依存し得る。

**確認**

- 更新前に全 consumer、secret store、read / write role を列挙し、同じ保守単位の checklist へ固定したか。
- 各 consumer が対象世代固有の identity で新規接続し、必要な runtime peer がすべて ready になったか。
- credential 整合の証拠を、process の started、既存 connection の継続、別 consumer の成功とは別に得たか。
- rotation 後の再起動や connection recycle が失敗した場合、release gate が失敗として停止するか。

**参照先**

- [CI・リリース規約の Credential Rotation](../release.md#credential-rotation)
- [テスト・品質規約の External Service Evidence Catalog](../test-rule.md#external-service-evidence-catalog)

### L12 source の token を production asset に存在するとみなさない

**該当条件**

- runtime の値から CSS token、custom property、utility class などの識別子を組み立てる。
- source detection、tree-shaking、minification で未使用 output を除く build tool を使う。
- stylesheet の定義、unit test、development 表示を production build の証拠にしようとしている。

**確認**

- consumer が必要とする識別子が、変換後の production asset にすべて残ることを直接確認したか。
- 最終 CSS や browser paint を確認済みとする場合、それぞれの境界を直接確かめる証拠で判断したか。source 上の定義や文字列 mapping の成功は、その範囲の証拠として扱ったか。
- build checker を置く場合、canonical build と container build の両方が同じ checker と入力を使うか。
- browser evidence は exact 色値や DOM 構造ではなく、定義済み paint、系列の識別可能性、非色 signifier を観測しているか。

**参照先**

- [テスト・品質規約の UI Conformance](../test-rule.md#ui-conformance)
- [Change Gates](../dev-rule.md#change-gates)
- [Web 実装規約の Build / Test Tooling](../web-rule.md#build--test-tooling)

### L13 Shared DB migration は owner の authoring 手順から始める

**該当条件**

- `momo-db` の schema、migration、Drizzle 設定・script、または migration state を変更する。
- `momo-result` や `summit` から共有 DB の変更を依頼・実装する。

**確認**

- 対象 checkout の `docs/development.md` を全文確認してから変更を始めたか。
- 対象 migration の適用状態を確認し、fresh 検証には保存対象 DB とは別の DB を使い、existing DB の data 保持を別に確認したか。
- 移行中の契約に該当する場合、撤去条件と混在禁止を [Transitional Contracts](../db-rule.md#transitional-contracts) で確認したか。

**参照先**

- [変更前の手順](../../AGENTS.md#作業境界)
- [DB 規約の Ownership](../db-rule.md#ownership)

### L14 algorithm version と release 世代は定数更新で完了しない

**該当条件**

- algorithm version、artifact schema version、validation contract、release singleton、desired version の昇格を変更する。
- 分析の release evidence、rollback 対象、fixture が触る baseline migration を変更する。

**確認**

- deploy 重複と lease 失効後の旧 process に対する DB fence の拒否と物理的な計算枠の区別は、[L8](#l8-高負荷分析は通常経路のコストと観測を先に固定する) の確認を併せて使う。
- algorithm version 変更の完了を、定数と worker image の更新に加えて、対応 reader / worker、desired version 昇格、queued job の収束、非対応 delivery の観測を別々に確認して判断したか。
- fresh DB の release singleton を fixture で変更する前に、promotion 済み DB や test 内の明示 UPDATE ではなくその fresh DB で、algorithm / artifact schema / validation contract の exact tuple を確認したか。
- rollback 時は表示名ではなく、影響を受けた全実行経路を覆う差分か確認したか。

**参照先**

- [分析 batch 要求の Compatibility / Release / Rollback](../requirements/series-analysis-batch.md#8-compatibility--release--rollback)
- [DB 規約の Contract Evidence](../db-rule.md#contract-evidence)
- [CI・リリース規約の Analysis Promotion and Backfill](../release.md#analysis-promotion-and-backfill) と [Rollback Verification](../release.md#rollback-verification)
