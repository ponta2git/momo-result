# テスト・品質規約

目的: 変更リスクに対して、どの実行経路をどの oracle で検証するかを決める。実行 command は `docs/dev-rule.md`、coverage / CI 構成は `docs/test-architecture.md` を正本とする。

## 1. Principles

- 失敗し得る production 経路を最も近い層で直接通す。隣接層の成功を代用証拠にしない。
- unit test は純粋な分岐と状態遷移、integration test は DB / Redis / filesystem / process / wire、E2E は利用者の主要契約を検証する。
- oracle は「crash しない」ではなく、状態、値、request / response、永続 row、delivery disposition、外部副作用へ置く。
- branch 数ではなく業務上独立した条件を decision table にする。境界値、失敗、retry、cancel、競合、stale owner を含める。
- clock、ID、乱数、外部応答、非同期待ちは制御可能にし、実時間 sleep と test 順序へ依存しない。
- skip / 未実行の外部依存は未検証と報告する。mock の成功を live wire の成功として扱わない。

## 2. Test Layers

| 層 | 主な責務 |
| --- | --- |
| Unit / property | 純粋変換、validation、数式、状態機械、decision table |
| Component / usecase | UI 操作、application workflow、port 契約 |
| Contract / integration | schema、repository、queue、process、外部 wire |
| E2E / runtime smoke | 主要 user flow、組み上がった runtime、isolation / resource 契約 |

同じ詳細を全層で重複検証せず、下位層で固定した分岐は上位層では接続と代表経路に絞る。

## 3. Web Rules

### Query / API Error

- fatal error、cached data を保った refetch、認証待ち、disabled query、retry success を別ケースにする。
- query key ごとの runtime data shape と、mutation 後の detail / list / selector cache の整合を検証する。
- API wrapper は status、Problem Details、credential / CSRF、retry / idempotency の外部契約を assertion にする。

### Form / Interaction

- Testing Library と user-event で実操作を通し、label、value、disabled / pending、validation、送信 payload、成功後状態を確認する。
- route / prefill / hidden identifier と optional discriminator が parse / transform 後も残り、mode ごとの副作用が変わることを固定する。
- event 値、連打、cancel、server error、再送を含める。implementation detail の関数呼出し回数を主 oracle にしない。

### Test Foundation / Doubles

- fixture は生成型 / domain 型に追従させ、意味のある factory へ集約する。大量の inline payload や型 cast で契約を迂回しない。
- MSW / store / storage / timer は test lifecycle で reset し、test 間で状態を共有しない。
- double は production adapter の guard と失敗型を表現する。double 独自の簡略状態を期待値にしない。
- async は Promise、MSW、fake clock で決定論的に進める。

### Locator / E2E

- locator は role、accessible name、label、安定した業務識別子を優先する。CSS 構造や表示順へ依存しない。
- 主要 flow は URL、画面状態、request、保存結果、download など外部契約で判定する。screenshot は補助証拠とする。
- retry 後も test-owned ID で対象 resource を特定し、前 attempt の data を成功条件にしない。
- UI / E2E 変更は Playwright で PC / mobile の主要状態を確認する。

### UI Conformance

- UI checkerはraw palette、undefined token、arbitrary spacing、small hit target、motion、reduced-motionを決定論的に検査する。視覚レビューでは階層、読み幅、関係的余白、目的・現在地・主要操作の発見可能性を確認する。
- 主要flowは320 / 375 / 414 / 768pxとdesktopの代表viewportで、意図しない横scroll、safe area、labelの崩れ、dialog / disclosureのfocus復帰と位置変化を確認する。
- component / E2Eではkeyboard、accessible name、status announcement、local error、pending中の重複操作を実操作で確認する。Trunk Test / cognitive walkthroughはscreenshotではなく、目的・現在地・次操作を説明できるかをoracleにする。

## 4. API Rules

- endpoint は wire validation、auth / CSRF、status / Problem Details、usecase 接続を検証する。
- usecase は状態遷移、競合、transaction 内の副作用、port failure mapping を検証する。
- generated OpenAPI と Web 型は contract 変更の同じ gate で更新・確認する。
- in-memory adapter と repository の guard が一致する代表ケースを共有 contract として持つ。

### DB-backed API

- migration 適用済みの実 PostgreSQL で変更 query を実行する。DB contract、repository integration、HTTP / usecase test の責務を分ける。
- FK、lock 順、constraint、SQLSTATE、transaction rollback、同時更新、cleanup を production と同じ statement 境界で確認する。
- pooler / proxy、接続 option、read-only probe は直接 DB test と別の wire 契約として検証する。
- 詳細な consumer 条件は `docs/db-rule.md` に従う。

### Performance-sensitive Analytics

- 保存済み artifact の bounded read を確認し、HTTP request 内で engine を実行しない。
- 最大 response / JSON complexity、decode concurrency、DB connection 解放、cleanup 競合、artifact pinning を境界値で検証する。
- 機能成功と resource / performance を分け、本番同等 runtime の測定がなければ性能を確認済みとしない。

## 5. Processing Worker Rules

Analysis / OCR の共通 contract として、次を固定する。

- `consume -> claim / lease / slot -> child -> candidate validation -> durable commit -> post-commit effect -> delivery disposition` の順序。
- parent が DB、Redis、object、process、timeout、fence、outbox、ACK を所有し、child は1 attempt の bounded candidate だけを返すこと。
- terminal DB write 前に ACK しないこと、rollback では wake しないこと、append 後の DB failure と重複 delivery が安全に収束すること。
- startup / PEL recovery、wake coalescing、deadline、bounded drain、backoff を制御可能 clock と signal で検証し、idle 時の無条件 polling を許さないこと。
- supervisor の shutdown、unexpected child / coordinator exit、sibling 停止、process group 回収。
- DB / Redis / Linux process / native engine は通常 unit test から分離し、検証済み runtime image と隔離 service で通すこと。

OCR は schema / screen type、object metadata、parser / postprocess、failure mapping、ACK / pending / DLQ、draft payload を外部 oracle にする。accuracy は version 固定 dataset と項目別 oracle で測り、未知画像への一般化を保証したと報告しない。

## 6. Analysis Capability / Worker Role Rules

- 純粋計算は table / property / golden test で、分母、同値、丸め、入力順、seed、品質状態を固定する。浮動小数点の oracle は手計算、高精度参照、数学的性質のいずれかを使う。
- 意図した結果変更は根拠、影響 fixture、algorithm version を同じ変更に含める。既存実装の値だけを唯一の正解にしない。
- DB job / intent / slot / lease / fence / artifact は実 PostgreSQL、delivery / pending / ACK は実 Redis、timeout / OOM / kill / reap / preemption は実 process で検証する。
- stale fence、重複 delivery、commit 応答不明、unsupported version、partial staging、publication rollback、cleanup 競合を直接通し、部分公開・二重公開・孤立 job を残さない。
- child の resource limit は対象 cgroup の readback / event と parent 生存を同時に確認する。host 上の制限や runtime 全体 OOM で代用しない。
- artifact materialization は byte / node / depth / UTF-8 / checksum / path / symlink / disk 境界を検証する。
- OCR preemption は一方向、失敗回数非加算、旧 child 回収後の再実行を実 process / DB で確認する。
- resource / endurance gate は release build、production 相当の上限、代表 data で機能 gate と分けて実行する。

job、publication、artifact、version の詳細ケースは `docs/requirements/series-analysis-batch.md` を正本とし、この文書へ列挙しない。

## 7. Coverage / C2

- threshold と対象 file は各 tool 設定、CI artifact は `docs/test-architecture.md` を正本とする。
- aggregate coverage を重要経路の証拠にしない。blast radius の大きい module は明示した table / property / contract test を持つ。
- branch coverage だけで C2 を満たしたとせず、discriminator、複合条件、loading / error / cached data など独立因子を decision table にする。
- fixture の shape 変更は生成型、domain 型、`satisfies` などで compile failure にする。

## 8. External Services

- external test は test / suite ごとに DB row、stream、object、file、worker identity を隔離する。
- provider / CI action の wire fixture は実契約の表現を使い、producer の正規化結果を consumer validator まで通す。
- release の producer attempt と consumer attempt が異なるケース、通常 deploy と rollback の両方を同じ provenance validator で検証する。
- 公開 edge test は URL だけでなく観測地点を契約に含め、意図的に拒否される地点を blocking oracle にしない。
- deploy / credential rotation の dependency gate は、対象世代固有の identity で新規接続を直接確認する。更新前から生存する connection、process の起動状態、別 consumer の成功を代用証拠にしない。
- live credential を tracked file、docs、log に出さない。

## 9. Quality Gates

変更種別ごとの command は `docs/dev-rule.md` の Change Gates を正本とする。契約、schema、algorithm version、production OS / runtime、resource profileを変えた場合は、それぞれの専用 contract / integration / smoke を追加する。lint、test 分類、architecture checker を弱める場合は、同等以上の決定的検査を同じ変更で用意する。

完了前に `docs/post-mortem/lessons.md` の該当カードだけを確認し、未検証の外部依存と残リスクを報告する。
