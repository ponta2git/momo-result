# テスト・品質規約

目的: アプリ利用者へ提供する価値と変更リスクに対して、どの実行経路をどの oracle で検証するか、また何を検証対象にしないかを決める。実行 command は `docs/dev-rule.md`、test size、coverage、CI artifact は `docs/test-architecture.md` を正本とする。

## 1. 証拠モデルと正本

- 利用者価値と業務意味は要求、domain、UI 規約を、実装境界は architecture、wire / schema はそれぞれの契約を正本とする。test、fixture、snapshot、lint、checker、coverage は正本の一部を観測する品質証拠であり、それ自体から新しい要求を作らない。
- green は、宣言した境界、入力、oracle の範囲で違反を観測しなかったことだけを示す。システム全体の正しさや利用者価値を決定論的に保証したとは表現しない。
- 失敗し得る production 経路を、その因果を判定できる最も近い層で直接通す。隣接層、double、生成成功、coverage の成功を、通していない経路の代用証拠にしない。
- 人間の承認、復旧判断、手順遵守は private runbook を正本とし、test contract を別に複製しない。runtime / deploy の自動検証は、アプリ利用者への到達性、data 保全、機能、resource 契約を守る場合に限って品質証拠とする。

## 2. テストの採用・維持・削除

test case または独立した test suite を追加・維持するときは、次の順で判断する。

1. 守るアプリ利用者の結果と、失敗時の影響を特定する。共通実装では直接の利用者をその実装の consumer とし、最終的なアプリ利用者への影響まで遡る。技術的な難しさ、実装規約、未検証であることだけでは採用理由にしない。
2. その結果を壊す実行経路と独立した失敗条件を特定する。複数 component の組み合わせで初めて価値または失敗が現れる場合は、個別 unit test へ分解して保証したことにせず、integration / component / E2E の組み上がった境界で判断する。
3. 利用者または実装 consumer が観測できる結果へ oracle を置く。判定に必要な oracle を置けない、または「crash しない」「呼ばれた」だけでは価値を判定できない場合は、test を追加しない。
4. 既存の test、型、schema、lint、生成照合、上位経路、manual review が同じ失敗をどこまで検出するか確認する。追加証拠の検出価値が developer 待ち時間、保守負担、誤検出を上回る場合だけ追加する。代替証拠がなくても利用者価値が薄ければ追加しない。
5. 選んだ境界で、業務上独立した条件、境界値、代表的な失敗を最小集合にする。branch や実装行を埋めるために case を増やさない。

- 技術的難易度、変更頻度、過去の欠陥、競合、外部 I/O、復旧困難性は、利用者影響がある候補の優先度と test size を決める要因であり、単独の採用理由ではない。
- 共通実装は、consumer から見える契約を同値 class、境界、意味の異なる mode に分け、各 partition の代表を検証する。全 call site や内部 branch の機械的な網羅を求めない。
- test 数や test / production LOC に一律の上限・比率を置かない。ただし、同じ失敗を重複して検出する case、正本を写しただけの assertion、弱い oracle、慢性的に信頼できない test は、追加時だけでなく変更時にも統合・削除を検討する。
- 実行が速いことは採用・維持の理由ではなく、遅いことだけも削除理由ではない。価値ある証拠は境界や setup を改善し、価値の薄い証拠は速くても残さない。
- 不具合修正でも回帰 test を自動的に追加しない。利用者影響、再発可能性、因果経路、既存証拠を同じ基準で評価し、必要な場合は実際に失敗した production 経路を通す。

以下の各領域に列挙する条件は、対象変更で検討する failure-mode catalog である。一項目ごとに独立した test を要求する一覧ではない。選択した条件については、記載した境界と oracle を満たす。

## 3. Test Layers

| 層 | 主な責務 |
| --- | --- |
| Unit / property | 純粋変換、validation、数式、状態機械、decision table |
| Component / usecase | UI 操作、application workflow、port 契約 |
| Contract / integration | schema、repository、queue、process、外部 wire |
| E2E / runtime smoke | 主要 user flow、組み上がった runtime、isolation / resource 契約 |

同じ詳細を全層で重複検証せず、下位層で固定した分岐は上位層では接続と代表経路に絞る。

- unit test は純粋な分岐と状態遷移、integration test は DB / Redis / filesystem / process / wire、E2E は利用者の主要契約を主な対象とする。ただし、test size を小さくするために production の失敗境界を double へ置き換えない。
- 下位 size では価値に関係する partition を詳しく、上位 size では接続、複合的な失敗、代表経路へ絞る。量感は依存境界が広いほど少なくするが、固定比率は設けない。
- clock、ID、乱数、外部応答、非同期待ちは制御可能にし、実時間 sleep と test 順序へ依存しない。
- test は並列実行を既定とし、resource、DB row、schema、stream、object、file、port、clock を test ごとに隔離する。共有状態や順序そのものが契約である場合だけ直列化し、理由と対象範囲を設定の近くへ残す。
- skip / 未実行の外部依存は未検証と報告する。mock の成功を live wire の成功として扱わない。

### Oracle の強さ

- oracle の強さは、利用者または共通実装の consumer が区別する結果に合わせる。保存値、順位、権限、download 内容、delivery disposition の違いが判断や data 保全を変えるなら exact value / state / side effect まで確認する。
- 複数の出力が同じ価値を持つ場合は、property、範囲、schema、順序非依存など価値判断に必要な関係だけを確認し、内部の並び、DOM 構造、call count、文言断片まで固定しない。
- presence、HTTP success、process 生存、「例外がない」は、それ自体が利用者契約である場合だけ主 oracle にできる。より具体的な結果が価値を決める場合は補助証拠に留める。
- screenshot、coverage、mock の呼出し、snapshot は補助 oracle とする。正本の意味や production boundary の結果を直接判定できる場合は、そちらを優先する。

## 4. Web Rules

### Query / API Error

- fatal error、cached data を保った refetch、認証待ち、disabled query、retry success を別ケースにする。
- query key ごとの runtime data shape と、mutation 後の detail / list / selector cache の整合を検証する。
- 時間経過、window focus、tab visibility、network reconnect では request 数が増えず、明示した更新 / 再試行だけが再取得することを、共通 QueryClient の unit test で固定する。重要 flow で複合的な価値が変わる場合だけ component / integration test を追加し、production source 全体の文字列検査で代用しない。
- API wrapper は status、Problem Details、credential / CSRF、retry / idempotency の外部契約を assertion にする。

### Form / Interaction

- Testing Library と user-event で実操作を通し、label、value、disabled / pending、validation、送信 payload、成功後状態を確認する。
- route / prefill / hidden identifier と optional discriminator が parse / transform 後も残り、mode ごとの副作用が変わることを固定する。
- event 値、連打、cancel、server error、再送を含める。implementation detail の関数呼出し回数を主 oracle にしない。

### Loading / Optimistic Update / Motion

- loading は、初回 suspend、異なる pathname の未準備、同一 pathname の filter / scope 変更、cached data を保った refetch、補助 data の失敗を別ケースにする。初回と異なる pathname では最終 layout に近い structural fallback、同一 pathname の変更と refetch では既存内容の維持、誤操作を招く stale scope では対象操作の無効化、各 scope では一つの loading feedback だけが現れることを検証する。
- Suspense fallback と完成内容の切替に animation lifecycle がなく、route content、安定した surface、open / focus が Motion の完了を待たないことを確認する。dialog や disclosure は body が suspend または exit 中でも keyboard 契約と focus 復帰を保ち、非対話的な exit node が操作対象または accessibility tree に残らないことを検証する。
- 楽観更新は pending、success、server correction、rollback、retry、同時 mutation を decision table にする。安定した identity、重複操作の抑止、局所 error、canonical data への収束を主 oracle とし、presence や opacity を状態の唯一の oracle にしない。
- motion を伴う操作は、通常、途中で逆方向へ変更、unmount、連打、animation 完了 callback 未実行、`prefers-reduced-motion` の各条件で同じ application state と操作可能性へ収束することを、制御した state と clock で検証する。duration の経過だけを待つ test や screenshot 差分だけを主 oracle にしない。
- viewport を使う図表は、初回と再進入では完成値、表示中の同一 identity の値変更だけが補間対象、表示領域外の更新は再進入時に再生されないことを固定する。IntersectionObserver と clock は test から制御し、実時間 scroll や sleep に依存しない。
- Motion の import / bundle 境界は syntax-aware な標準 lint で低誤検出に判定できる規則だけを検査する。状態収束、操作可能性、reduced motion、focus は shared primitive の component test と、利用者価値が現れる代表 flow で検証する。

### Test Foundation / Doubles

- fixture は生成型 / domain 型に追従させ、意味のある factory へ集約する。大量の inline payload や型 cast で契約を迂回しない。
- MSW / store / storage / timer は test lifecycle で reset し、test 間で状態を共有しない。
- double は production adapter の guard と失敗型を表現する。double 独自の簡略状態を期待値にしない。
- async は Promise、MSW、fake clock で決定論的に進める。

### Locator / E2E

- locator は role、accessible name、label、安定した業務識別子を優先する。CSS 構造や表示順へ依存しない。
- 主要 flow は URL、画面状態、request、保存結果、download など外部契約で判定する。screenshot は補助証拠とする。
- retry 後も test-owned ID で対象 resource を特定し、前 attempt の data を成功条件にしない。
- 選択した主要 flow は、変更が影響する PC / mobile の代表状態を Playwright で確認する。responsive behavior が変わらない変更へ viewport case を機械的に追加しない。

### UI Conformance

- 静的検査は、syntax-aware な標準 tool で意味を一意に判定でき、違反が利用者価値を損なう規則に限る。視覚レビューでは階層、読み幅、関係的余白、目的・現在地・主要操作の発見可能性を確認する。
- responsive behavior が利用者価値へ影響する変更は、対応する最小幅と、layout mode が変わる代表 viewport で、意図しない横 scroll、safe area、label の崩れ、dialog / disclosure の focus 復帰と位置変化を確認する。同じ layout mode の近接幅を一律に重複実行しない。
- component / E2Eではkeyboard、accessible name、status announcement、local error、pending中の重複操作を実操作で確認する。Trunk Test / cognitive walkthroughはscreenshotではなく、目的・現在地・次操作を説明できるかをoracleにする。

## 5. API Rules

- endpoint は wire validation、auth / CSRF、status / Problem Details、usecase 接続を検証する。
- usecase は状態遷移、競合、transaction 内の副作用、port failure mapping を検証する。
- Tapir endpoint を HTTP 契約の正本とし、内部 Web codegen 用の生成 OpenAPI と Web 型は派生物として同じ contract gate で更新・確認する。生成 OpenAPI は consumer が必要とする構造規則を生成時に lint し、tracked artifact との一致を確認してから Web 型を生成する。
- OpenAPI lint は unresolved reference、path / parameter、schema、operation identity など構造整合性を扱う。field の公開可否、認証・業務意味、利用者価値は endpoint / DTO の設計正本と contract / integration test で判断し、legacy 名の文字列検索へ移さない。
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

## 6. Processing Worker Rules

Analysis / OCR の共通 contract として、次を固定する。

- `consume -> claim / lease / slot -> child -> candidate validation -> durable commit -> post-commit effect -> delivery disposition` の順序。
- parent が DB、Redis、object、process、timeout、fence、outbox、ACK を所有し、child は1 attempt の bounded candidate だけを返すこと。
- terminal DB write 前に ACK しないこと、rollback では wake しないこと、append 後の DB failure と重複 delivery が安全に収束すること。
- startup / PEL recovery、wake coalescing、deadline、bounded drain、backoff を制御可能 clock と signal で検証し、idle 時の無条件 polling を許さないこと。
- supervisor の shutdown、unexpected child / coordinator exit、sibling 停止、process group 回収。
- DB / Redis / Linux process / native engine は通常 unit test から分離し、検証済み runtime image と隔離 service で通すこと。

OCR は schema / screen type、object metadata、parser / postprocess、failure mapping、ACK / pending / DLQ、draft payload を外部 oracle にする。accuracy は version 固定 dataset と項目別 oracle で測り、未知画像への一般化を保証したと報告しない。

## 7. Analysis Capability / Worker Role Rules

- 純粋計算は table / property / golden test で、分母、同値、丸め、入力順、seed、品質状態を固定する。浮動小数点の oracle は手計算、高精度参照、数学的性質のいずれかを使う。
- 意図した結果変更は根拠、影響 fixture、algorithm version を同じ変更に含める。既存実装の値だけを唯一の正解にしない。
- DB job / intent / slot / lease / fence / artifact は実 PostgreSQL、delivery / pending / ACK は実 Redis、timeout / OOM / kill / reap / preemption は実 process で検証する。
- stale fence、重複 delivery、commit 応答不明、unsupported version、partial staging、publication rollback、cleanup 競合を直接通し、部分公開・二重公開・孤立 job を残さない。
- child の resource limit は対象 cgroup の readback / event と parent 生存を同時に確認する。host 上の制限や runtime 全体 OOM で代用しない。
- artifact materialization は byte / node / depth / UTF-8 / checksum / path / symlink / disk 境界を検証する。
- OCR preemption は一方向、失敗回数非加算、旧 child 回収後の再実行を実 process / DB で確認する。
- resource / endurance gate は release build、production 相当の上限、代表 data で機能 gate と分けて実行する。

job、publication、artifact、version の詳細ケースは `docs/requirements/series-analysis-batch.md` を正本とし、この文書へ列挙しない。

## 8. Coverage / C2

- aggregate coverage は非 blocking の report とし、対象 file、除外、丸め、artifact は tool 設定と `docs/test-architecture.md` を正本とする。
- aggregate coverage を重要経路の証拠にしない。利用者影響が大きく、誤りやすい module は、採用基準を満たす場合に明示した table / property / contract test を持つ。
- branch coverage だけで C2 を満たしたとせず、discriminator、複合条件、loading / error / cached data など独立因子を decision table にする。
- fixture の shape 変更は生成型、domain 型、`satisfies` などで compile failure にする。

## 9. External Services

- external test は test / suite ごとに DB row、stream、object、file、worker identity を隔離する。
- provider / CI action の wire fixture は実契約の表現を使い、producer の正規化結果を consumer validator まで通す。
- release の producer attempt と consumer attempt が異なるケース、通常 deploy と rollback の両方を同じ provenance validator で検証する。
- 公開 edge test は URL だけでなく観測地点を契約に含め、意図的に拒否される地点を blocking oracle にしない。
- deploy / credential rotation の dependency gate は、対象世代固有の identity で新規接続を直接確認する。更新前から生存する connection、process の起動状態、別 consumer の成功を代用証拠にしない。
- live credential を tracked file、docs、log に出さない。

## 10. Quality Gates

変更種別ごとの command と gate の役割は `docs/dev-rule.md` の Change Gates を正本とする。契約、schema、algorithm version、production OS / runtime、resource profile を変えた場合も、まず本書の採用基準で既存証拠と利用者影響を評価し、必要な contract / integration / smoke の最小集合を選ぶ。

- lint、checker、test を廃止・縮小するとき、機械的に同等検査を追加する義務はない。守っていた利用者価値、正本、検出能力を再評価し、価値が薄い、誤検出が多い、他の証拠で十分な場合は捨てる。価値ある決定的検査が必要なら、custom script より保守された標準 tool と既存設定を優先する。
- blocking gate は product-value evidence または pipeline-integrity evidence のどちらか一つの役割を持つ。coverage、module size、flake、developer wait の推移は report とし、それ単独で product behavior を証明しない。
- retry で成功した test は green としてよいが、test ID、最初の失敗、attempt 数を PR summary に出し、再現に必要な trace / log を artifact として残す。retry を通常成功へ畳み込んで観測不能にしない。

完了前に `docs/post-mortem/lessons.md` の該当カードだけを確認し、未検証の外部依存と残リスクを報告する。
