# テスト・品質規約

目的: アプリ利用者へ提供する価値と変更リスクに対して、どの実行経路をどの oracle で検証するか、また何を検証対象にしないかを決める。実行 command と必須 gate は [開発作業規約](dev-rule.md)、test size、coverage、実行境界、CI artifact は [テスト実行設計](test-architecture.md) を正本とする。検証の終了、人間による確認の位置づけは [AGENTS.md](../AGENTS.md#検証と完了) に従い、本書は繰り返さない。

## 証拠モデルと正本

- 利用者価値と業務意味は要求、domain、UI 規約を、実装境界は architecture と各 subsystem 規約、wire / schema はそれぞれの契約を正本とする。test、test-local fixture、snapshot、lint、checker、coverage は正本の一部を観測する品質証拠であり、要求は正本から導く。
- 失敗し得る production 経路を、その因果を判定できる最も近い層で直接通す。経路の証拠はその経路を通した結果に限り、隣接層、double、生成成功、coverage の成功では代用しない。
- 人間の承認、復旧判断、手順遵守は private runbook だけを正本とする。runtime / deploy の自動検証は、アプリ利用者への到達性、data 保全、機能、resource 契約を守る場合に限って品質証拠とする。

## 品質証拠の採用・維持・削除

test、suite、lint / checker、manual review は、守る価値に対して必要なものだけ採用・維持する。次の観点は判断を助けるために使い、採点表や全項目の記録は任意とする。

1. 守るアプリ利用者の結果と、失敗時の影響を特定する。共通実装では直接の利用者をその実装の consumer とし、最終的なアプリ利用者への影響まで遡る。採用理由は利用者への影響に置き、技術的な難しさ、実装規約、未検証であることは単独の理由にしない。
2. 複数 component の組み合わせで初めて価値または失敗が現れる場合は、個別 unit test への分解ではなく、組み上がった境界で判断する。
3. 利用者または実装 consumer が依存する観測可能な結果へ oracle を置く。視覚階層や文章の適切さなど、自動 oracle が不適切な結果は対象を絞った manual review で判断する。
4. 既存の test、型、schema、lint、生成照合、上位経路、manual review が同じ失敗をどこまで検出するか確認する。残すのは検出価値に対して待ち時間、保守負担、誤検出が見合うものだけとし、代替がない場合も価値の薄い evidence は足さない。
5. case は業務上独立した条件、境界値、代表的な失敗の最小集合とし、branch や実装行を埋めるためには足さない。

- 検出価値と保守負担の比較や見た目の良さは、点数・比率・閾値に置き換えず定性的に判断してよい（[AGENTS.md](../AGENTS.md#判断と並列作業)）。権限、保存値、互換性、resource 上限など明確な契約は直接検証する。
- 判断結果は維持、追加・置換、統合・削除、または evidence を置かない、のいずれでもよい。変更説明には選んだ証拠と重要な未検証事項を残す。追加・削除などの判断を理解するために必要なら、守る価値、境界 / oracle、重複や非採用の理由を補う。非採用理由は判断に関わる項目に絞り、catalog 全項目には及ばせない。
- 技術的難易度、変更頻度、過去の欠陥、競合、外部 I/O、復旧困難性は、利用者影響がある候補の優先度と test size を決める要因であり、単独の採用理由ではない。
- 共通実装は consumer から見える契約の partition ごとの代表を検証する。全 call site や内部 branch の機械的な網羅は求めない。
- test 数や test / production LOC は対象ごとに判断し、一律の上限・比率は置かない。ただし、同じ失敗を重複して検出する case、正本を写しただけの assertion、弱い oracle、慢性的に信頼できない test は、追加時だけでなく変更時にも統合・削除を検討する。
- 採用・維持・削除は、証拠の検出価値と実行時間を含む維持負担を併せて判断する。価値ある証拠は遅ければ境界や setup を改善し、価値の薄い証拠は速くても削除する。
- 不具合修正でも、回帰 test の追加は利用者影響、再発可能性、因果経路、既存証拠を同じ基準で評価して決め、必要な場合は実際に失敗した production 経路を通す。可逆で影響の小さい変更に、実装を写すだけの test は追加しない。

### UI の検証を選ぶ基準

画面で観測できることと、恒久的な自動 test にする価値があることを区別する。本節が UI の選択基準と自動化境界を所有し、visual review で確認する観点は [UI 規約の視覚レビューの観点](ui-rule.md#視覚レビューの観点) が所有する。何を選ぶかの基準と、選んだ evidence で守る境界は分けて読む。

| 失敗時の影響 | 検証の選び方 |
| --- | --- |
| 入力・保存値の消失、別対象への送信、二重確定、権限逸脱、誤った結果表示 | 実際の入力・request・保存値・対象 identity を観測する。独立した失敗条件と復旧経路を優先して自動化する |
| 必要な操作へ到達できない、待機や失敗から復帰できない | keyboard、focus、disabled / pending、再試行を、操作続行まで通る最も近い境界で検証する |
| 余白、揃え、装飾、軽微な位置変化、hover / transition の見え方 | 原則として変更時の visual review で扱う。恒久 test や専用 checker による自動検証は、操作不能・内容欠落などの具体的な影響がある場合に限り、その結果を対象にする |

- DOM の内外・前後、座標、CSS class / custom property、duration、easing、装飾文言は、それ自体としては回帰契約の対象外とする。画像の保持を検証する flow に、隣接するボタンの配置測定を追加することも同じ基準で判断する。
- accessibility は見た目の微調整とは別に扱い、操作名の識別、keyboard での到達・実行、modal の focus 管理などは操作成立の条件として選ぶ。ライブラリの素の挙動や共通 primitive の契約は既存の証拠を再利用し、追加が必要な共通契約の検証は primitive 側に集約する。
- browser 固有の失敗、実 API との接続、主要な一連の操作を検証するときに E2E を選ぶ。component で十分に判定できる分岐はその証拠を再利用し、E2E は代表的な状態・画面・layout mode に絞る。
- 低価値な自動検証を削除した後の手動確認も、全変更に一律ではなく変更の影響に応じて選ぶ。visual review も同様に選ぶ。
- 簡素化は件数の削減ではなく、不要な保守対象の削減で判断する。case の統合では assertion、fixture、mock、helper も見直し、独立した検出価値のない保守対象を取り除く。

次の各項目は、その evidence を選んだ場合だけ適用する。共通表示の変更に既存の型・visual review で足りると判断した場合、その証拠で検証を完了できる。

- 静的検査を選ぶ場合: 採用は [Change Gates](dev-rule.md#change-gates) に従う。UI では未定義 token、禁止 import、構文上確定する依存境界など、違反を一意に判定できる規則だけを候補とし、検査結果が示す範囲は対象規則への適合に限る。raw value の有無、一定間隔の倍数、shadow や `z-index` の書式、近似色、表の alignment といった表層規則は、それ単独では blocking gate にしない。
- component test を選ぶ場合: shared primitive と利用者価値が現れる component を中心に、keyboard での到達・実行、入力保持、pending 中の重複操作、local error からの復旧を実操作で確認する。rendered size が必要な hit target は代表 flow の browser / visual evidence で確認し、各 component ではその証拠を再利用する。
- 複数画面が消費する対応関係（固定メンバー、プレー順、状態・意味 token など）の unit / component test を選ぶ場合: 共通の型・定義を実装上の正本とし、各画面の source 文字列ではなく、その consumer 契約を代表確認する。
- 主要 flow の Playwright を選ぶ場合: URL、request、保存、download、主要結果を主 oracle とする。responsive な切替で入力を失う、必要な操作へ到達できないといった browser 固有の失敗を自動化し、微細な揃え・safe area・dialog の配置は変更時の visual review で確認する。

## Evidence Layers

下位層で固定した分岐は上位層では接続と代表経路に絞る。ただし、production の失敗境界は、test size を小さくする場合も double ではなく実際の境界で通す。size、隔離、並列実行、直列化の例外は [テスト実行設計](test-architecture.md#test-size) に従う。screenshot、coverage、mock の呼出し、snapshot は補助 oracle に留める。

## Catalog の読み方

以下の各領域に列挙する条件は、対象変更で検討する failure-mode catalog である。条件に合う既存の証拠を含め、採用基準に従って必要な検証を選ぶ。各項目の命令形は、その条件を evidence に選んだ場合だけ適用する。[UI の検証を選ぶ基準](#ui-の検証を選ぶ基準) の「選んだ場合だけ適用する」項目も同じ読み方に従う。選択した条件については、記載した境界と oracle を満たす。契約そのものは各正本が持ち、catalog は観測する境界と oracle だけを書く。

## Web Evidence Catalog

選んだ場合に適用する。実装契約は [Web 実装規約](web-rule.md)、表示契約は [UI 規約](ui-rule.md) を正本とする。

### Query / API Error

- 自動再取得の契約は [Web 実装規約の Server State](web-rule.md#server-state) を正本とし、共通 QueryClient の unit test で固定する。重要 flow で複合的な価値が変わる場合だけ component / integration test を追加し、production source 全体の文字列検査で代用しない。
- query key ごとの runtime data shape と、mutation 後の detail / list / selector cache の整合を検証する。

### Form / Interaction

- route / prefill / hidden identifier と optional discriminator が parse / transform 後も残り、mode ごとの副作用が変わることを固定する。

### Loading / Optimistic Update / Motion

- loading / refetch は、入力・選択の消失、古い対象への操作、回復手段の消失を起こす条件を選ぶ。初回の取得と既存内容の再取得、対象変更の違いがその結果を変える場合に分け、状態の組合せは結果を変えるものに絞る。
- 制御した Promise / 通信で pending と確定後を観測し、操作制限と解除、入力の保持、再試行の成功を主 oracle として判定する。spinner 数、skeleton 構造、mount 回数、待機中の寸法一致は補助的な観測に留める。
- dialog / disclosure の開閉や非同期表示で操作不能が起こり得る場合は、keyboard で操作を続けられ、閉じた内容が操作対象から外れることを代表経路で確認する。focus 復帰は具体的な戻り先と次操作で判定する。
- 楽観更新は pending、success、server correction、rollback、retry、同時 mutation を decision table にし、安定した identity、重複操作の抑止、局所 error、canonical data への収束を主 oracle とする。
- motion の状態別の自動検証は、animation 完了や timer に操作の成立が依存している場合に限り、中断や reduced motion で操作が失われる経路を対象にする。hover 色、補間の途中値、再生タイミング、duration などの見え方を確認する場合は、変更に必要な観点を選んで visual review を行う。これらの自動網羅は visual review の代用にしない。import / bundle 境界は [Web 実装規約](web-rule.md#client-lifecycle--suspense--motion) と [Change Gates](dev-rule.md#change-gates) に従う。

### Completion / Toast

- 通知先は [UI 規約](ui-rule.md#取得状態とフィードバック) を正本とし、遷移・dialog 閉鎖で完了確認場所が失われる操作、その場に結果が残る操作、局所回復が必要な失敗を代表例に選ぶ。toast の呼出しだけでなく、利用者に現れる結果と次の操作を確認する。
- 保存確定後の再取得失敗、結果不明、処理の受付と完了を分け、誤った成功・失敗や二重通知を防ぐ。同じ実行の再描画・cache 更新で通知数を保ち、別の実行結果を区別して扱うことを確認する。通知の有無と表示先は UI 規約に従う。
- 共通 host は、遷移・body の準備待ちでも必要な完了結果へ到達でき、通知が主要操作を妨げない代表経路を検証する。表示上限や閉鎖で外れた通知が操作対象に残るなど、操作続行に影響する失敗を選ぶ。寿命・配置・animation の確認を選ぶ場合は共通 host に集約し、各画面ではその証拠を再利用する。
- live region の配置と accessible state は component / browser で確認し、実際の読み上げ回数・順序を保証する場合は screen reader で確かめる。DOM の role 数や `aria-busy` の存在だけを、その保証の代用にしない。

### Test Foundation / Doubles

- fixture は意味のある factory へ集約し、大量の inline payload や型 cast に頼らず生成型 / domain 型の契約に従って作る（test では unsafe type assertion の lint が無効）。
- double は test が扱う操作の guard と失敗型を表現し、未実装の保存・副作用を成功として扱わない。double が表すのは test が扱う範囲に限り、期待値は double 独自の簡略状態ではなく production の契約から作る。

### Locator / E2E

- retry 後も test-owned ID で対象 resource を特定し、成功条件は当該 attempt の操作結果で判定する。
- システム E2E は基本操作の完了と、データ損失・操作続行不能を避ける回復経路を選ぶ。完了は受付成功や画面の存在ではなく、対象 ID と再取得した値・出力・利用側への反映で判定する。細かな状態分岐や通知書式は、それを所有する component / unit に任せる。

### UI Conformance

- 自動 test の主 oracle と visual review の分担は [UI の検証を選ぶ基準](#ui-の検証を選ぶ基準) に従う。
- production CSS が source detection、tree-shaking、minification などで変換され、runtime が token、class、custom property の識別子を動的に選ぶ場合は、必要な識別子が最終 asset に残ることを production build 後の asset またはその asset を読む browser で直接確認する。変換前 stylesheet の定義、識別子文字列を返す unit test、development server の表示を代用証拠にしない。browser evidence を選ぶ場合は exact 色値や DOM 構造ではなく、consumer が必要とする定義済み paint、識別可能性、非色 signifier を oracle にする。

## API Evidence Catalog

選んだ場合に適用する。実装契約は [API 規約](api-rule.md) を正本とする。

- HTTP 契約の正本と OpenAPI / Web 型の生成関係は [API 規約の Wire Boundary](api-rule.md#wire-boundary) に従う。構造 lint と freshness は pipeline integrity、代表 request / response と利用者に現れる意味は contract / integration evidence として区別する。
- 存続する InMemory double と production adapter に条件ずれがある場合だけ、consumer が依存する代表的な受理・拒否と保存結果を小さい共有 contract で検証する。全 repository の二重実装・二重 suite は求めない。
- lock、rollback、競合、永続 job / replay の詳細を double へ追加する前に、該当 test を実 PostgreSQL へ移す。移行後は不要な simulator、fixture、重複 assertion を削除し、保守対象を一つにする。

### DB-backed API

- DB contract、repository integration、HTTP / usecase test の責務を分ける。DB contract を evidence に選んだ場合の production boundary と oracle は [DB 規約の Contract Evidence](db-rule.md#contract-evidence) に従う。
- pooler / proxy、接続 option、read-only probe は直接 DB test と別の wire 契約として検証する。

### Performance-sensitive Analytics

- 最大 response / JSON complexity、decode concurrency、DB connection 解放、cleanup 競合、artifact pinning を境界値で検証する。
- 機能成功と resource / performance を分け、性能を確認済みとするのは本番同等 runtime で測定した場合に限る。

## Processing Worker Evidence Catalog

選んだ場合に適用する。実装契約は [Worker 規約](worker-rule.md)、job 契約は [OCR job 契約](ocr-job-contract.md) を正本とする。Analysis / OCR の共通 contract として、次を観測する。

- `DB candidate -> instance resource reservation -> job claim / lease / fence -> child -> candidate validation -> durable commit -> post-commit effect` の順序。
- parent が DB、object、process、timeout、fence、結果確定を所有し、child は 1 attempt の bounded candidate だけを返すこと。
- retry / followup を durable に保存し、rollback では wake しないこと。commit 応答不明や重複 wake が二重実行権・二重公開にならないこと。
- 起動・再接続、wake coalescing、deadline、bounded drain、backoff を確認し、通知欠落は低頻度の補完走査で回復すること。
- campaign 展開と直接 claim を実 DB で通すこと。queued がなく期限切れ running だけが残る場合、先頭が非対応・lock 中の場合、将来の retry、複数親の競合を含める。
- PostgreSQL 通知を wake に使う場合、production と同じ pooling mode で session-bound listener への別接続 commit を通す。startup の `LISTEN` 成功や直接 DB だけの test を、通知 route の readiness evidence にしない。
- worker runtime の起動途中・稼働中の異常からの共通停止、単一期限内の子 process・補助 task 回収。listener の一時切断と構造異常、通知 sender 単独の異常は、それぞれの回復境界で確認する。
- DB / Linux process / native engine は通常 unit test から分離し、検証済み runtime image と隔離 service で通すこと。

OCR は schema / screen type、object metadata、parser / postprocess、failure mapping、retry / lease 回復、draft payload を外部 oracle にする。accuracy は version 固定 dataset と項目別 oracle で測り、報告はその dataset の範囲に限る（未知画像への一般化は保証しない）。契約変更ごとに直接通す境界は [OCR job 契約](ocr-job-contract.md#compatibility-and-verification) の表に従う。

## Analysis Capability / Worker Evidence Catalog

選んだ場合に適用する。契約は [分析 batch 要求](requirements/series-analysis-batch.md)、[DB 規約](db-rule.md)、[Worker 規約](worker-rule.md#analysis-publication-and-release-control) を正本とし、本書へ列挙しない。

- 純粋計算は分母、同値、丸め、入力順、seed、品質状態を固定する。浮動小数点の oracle は、既存実装の値だけに頼らず、手計算、高精度参照、数学的性質のいずれかを使う。意図した結果変更は根拠、影響 fixture、algorithm version を同じ変更に含める。
- DB job / intent / lease / persistent fence counter / artifact と通知は実 PostgreSQL、timeout / OOM / kill / reap / 実行継続は実 process で検証する。
- stale fence、重複 wake、commit 応答不明、unsupported version、partial staging、publication rollback、cleanup 競合を直接通し、部分公開・二重公開・孤立 job を残さない。
- child の resource limit は対象 cgroup の readback / event と parent 生存を同時に確認する。host 上の制限や runtime 全体 OOM で代用しない。
- artifact materialization は byte / node / depth / UTF-8 / checksum / path / symlink / disk 境界を検証する。
- publication を evidence に選ぶ場合、意味 oracle は Worker 規約が定める Rust の full semantic validator とし、exact validation contract、published row の immutability、API の bounded shape / identity defense をそれぞれの境界で検証する。
- analysis release の baseline migration、momo-db revision、default を変える場合の fresh baseline の確認は [DB 規約の Contract Evidence](db-rule.md#contract-evidence) に従う。移行中だけの契約と撤去条件は [Transitional Contracts](db-rule.md#transitional-contracts) に置く。
- release promotion は 2 接続の実 PostgreSQL で、capability 検査後の非互換登録が commit まで待つこと、singleton lock 中の新規作品が commit 後の tuple を継承すること、登録作品 0 件が terminal になることを検証する。
- 自動・手動の分析保守は、preview の非更新、対象 snapshot 変更時の拒否、互換性不足、同じ世代の再実行、未完了・失敗 target の識別を実 PostgreSQL で確認する。運用 runner は不正 report、配備世代変更、待機期限を失敗として扱い、release 完了は enqueue 成功ではなく保守の完了で判定する。
- 待機 OCR の優先と実行中の分析の完了を実 process / DB で確認する。旧世代が保存した中断 intent は失敗回数非加算、旧 child 回収後の再実行を保つ。
- resource / endurance gate は release build、production 相当の上限、代表 data で機能 gate と分けて実行する。
- 分析通知の通常更新は追加・変更試合数だけでなく、比較対象となる既存履歴の量と DB 往復も含めて確認する。有限の設定競合待ち後に通知が成立すること、残時間不足・長期競合では業務成功を保ち通知を省略することを実 DB で区別する。
- 分析通知の対象や比較元を変える場合は、純粋な差分 test に加えて要求の合流・release の参照切離し・公開成功を通す実 DB 経路を選ぶ。実送信はローカル receiver で固定本文と commit 後の状態を観測し、保守処理の抑止や設定・送信結果に依存しない入力基準を確認する。
- 通知の時間配分や DB アクセスを変える場合は、応答遅延を制御した実 DB 経路で、前後の成果物比較と OCR の業務確定を含む通知準備を通す。通知の固定内容と業務の成功状態を確認し、低遅延の直接接続だけを期限の根拠にしない。

## Coverage / Decision Coverage

- coverage の blocking / report、対象、artifact は [テスト実行設計](test-architecture.md#coverage-model) を正本とする。重要経路は coverage とは別に直接検証する。
- 利用者影響が大きく、誤りやすい module は、採用基準を満たす場合に table / property / contract test を持つ。複合条件は branch coverage の数値ではなく、利用者結果を変える discriminator、loading / error / cached data などの独立因子を並べた decision table で確認する。

## External Service Evidence Catalog

選んだ場合に適用する。release の契約は [CI・リリース規約](release.md) を正本とする。

- provider / CI action の wire fixture は実契約の表現を使い、producer の正規化結果を consumer validator まで通す。
- release の producer attempt と consumer attempt が異なるケース、通常 deploy と rollback の両方を同じ provenance validator で検証する。
- 公開 edge test は URL だけでなく観測地点を契約に含め、blocking oracle は意図した公開経路を通る地点に置く。
- deploy / credential rotation の dependency gate は、対象世代固有の identity で新規接続を直接確認する。更新前から生存する connection、process の起動状態、別 consumer の成功を代用証拠にしない。

## Quality Gate Handoff

本書で選んだ evidence を、[Change Gates](dev-rule.md#change-gates) の gate 役割と変更種別へ割り当てる。既存 evidence で足りる場合はその証拠を使い、test の追加・廃止・縮小は同じ採用基準で判断する。代替 check は守る価値が残る場合に限って作る。
