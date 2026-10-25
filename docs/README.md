# 文書索引

docs 以下の正本と実装入口へ、変更対象から最短で進むための索引である。横断する判断、固有の作業境界、検証と完了の原則は [AGENTS.md](../AGENTS.md) が持ち、本書と各正本はそれを参照する。

## 変更対象から読む

変更に関係する行から必要な章へ進む。確認済みの共通の参照は再利用し、関連する変更・矛盾・欠落が生じた範囲を見直す。

品質証拠は [テスト・品質規約] の採用基準と対象 catalog から選び、必須 gate とコマンドは [開発作業規約の Change Gates](dev-rule.md#change-gates) で確定する。test の size・実行構成・並列性・coverage・report を変更する場合だけ [テスト実行設計] を加える。CI の分類、release 候補、rollback は [CI・リリース規約]、本番操作の承認境界は [公開運用規約] に従う。

| 変更対象 | 正本・条件付き参照 | 実装入口 |
| --- | --- | --- |
| 業務要件 / CSV / TSV | [基本要求]、用語・状態は [ドメイン規約] | 対象 usecase / export |
| ログイン / ロール / 認可 | [基本要求] の認証・権限。分析操作は [分析 batch 要求]・[レーダー要求]。API の認証境界は [API 規約の Error / Auth](api-rule.md#error--auth)、Web の権限判断は [Web 実装規約の Server State](web-rule.md#server-state)、DB は [DB 規約] | 認証主体、API guard、アカウント管理、Web の権限制御 |
| 技術構成 / 非機能 | [システム要求]。境界と依存方向は [アーキテクチャ]、運用は [公開運用規約]、release は [CI・リリース規約] | 設定・runtime 定義 |
| Web / UI / UX / 文章 / IA | 対象画面の要求。表示・操作・文言は [UI 規約]、層・server state・motion・form の実装境界は [Web 実装規約]、wire は [API 規約の Wire Boundary](api-rule.md#wire-boundary)、用語は [ドメイン規約] | `apps/web/src/` の対象 component、global stylesheet、shared/ui、formatter |
| API / usecase | 対象要求、[API 規約]、状態は [ドメイン規約]、DB は [DB 規約] | `apps/api/`、Tapir endpoint、対象 job |
| Discord 通知 | 下表「複数文書にまたがる契約」の Discord 通知の分担 | NotificationSettings、管理画面、設定・取消の transaction、worker の notifications |
| DB / repository | [DB 規約]、対象の業務・job 要求。`momo-db` 側の変更前には [AGENTS.md](../AGENTS.md#作業境界) の事前手順 | 対象 query、隔離 test 用の pinned migration |
| OCR job / scheduler | [OCR job 契約](ocr-job-contract.md)、[DB 規約]、`docs/schemas/ocr-*.schema.json`。worker 構造は [Worker 規約の OCR Capability](worker-rule.md#ocr-capability) | API producer、`apps/processing-worker/` |
| 分析 job / artifact / worker / API | [分析 batch 要求]。DB は [DB 規約]、worker は [Worker 規約]、bounded read は [API 規約]、Web state は [Web 実装規約]、表示は [UI 規約]、指標は対象要求 | artifact / input schema、Tapir、processing-worker、Web |
| 戦績比較 | [比較要求](requirements/series-comparison.md)、[分析 batch 要求]。対象に応じ [オーナー別](requirements/series-owner-comparison.md)・[レーダー要求]・[見通し](requirements/series-rank-outlook.md)・[振り返り](requirements/series-review-playbook.md)、表示は [UI 規約] | artifact schema、worker、API / Web |
| 開催一覧・詳細 | [開催詳細要求]。業務前提は [基本要求]、メモは [試合メモ要求] | 対象 API / Web |
| 試合メモ | [試合メモ要求]。変更する境界に応じ [基本要求]、[開催詳細要求]、[分析 batch 要求]、[ドメイン規約]、[UI 規約] | Tapir、momo-db、API / Web |
| 実績リスト・初達成・実績軸 | [実績要求](requirements/player-achievements.md)。権限は [基本要求]、既存6軸は [レーダー要求]、再計算は [分析 batch 要求]、保存は [DB 規約の Achievement Data](db-rule.md#achievement-data) | 試合登録・編集、リスト管理、専用ページ、レーダー |
| テスト / coverage / CI | [テスト・品質規約]、[開発作業規約]、実行構成を変える時は [テスト実行設計]、CI の分類と release gate は [CI・リリース規約] | test 設定、workflow、対象経路 |
| ローカル起動 / コマンド / Git | [開発作業規約] の該当章 | package manifest、build 設定、script、workflow |
| release / deploy / rollback | [CI・リリース規約]、承認境界は [公開運用規約]、DB の切替は [DB 規約の Migration / Deployment](db-rule.md#migration--deployment) | workflow、`fly.toml`、CI 設定 |
| ポストモーテムの作成 / レビュー / 対策の再評価 | [postmortem skill](../.agents/skills/postmortem/SKILL.md)。個別記録・台帳は参照許可がある場合だけ | 実装を伴う場合は変更対象の行 |
| 文書 / 規約 / repository skill | 変更対象の正本。規約・skill は本書の「正本と証拠」「文書の増減と保守」、挙動を扱う時は実行経路と [教訓カード] | 対象文書と参照元、起動・完了条件、docs only gate |

ツール固有の入力・結果の意味は実装に隣接する文書を参照する。

- [cgroup memory probe](../scripts/tools/cmd/cgroup-memory-probe/README.md): 隔離実験の合格条件と適用範囲。
- [Linux memory snapshot](../scripts/tools/linux-memory-snapshot.md): 診断値の単位、欠測、計測範囲。
- [Rust OCR evaluator](../scripts/tools/cmd/ocr-rust-evaluator/README.md): 校正用の精度比較と限界。
- [OCR evaluation audit](../scripts/tools/cmd/ocr-evaluation-audit/README.md): 標本の独立性と必要量。
- [CI tool](../scripts/tools/cmd/ci-tool/README.md): CI data の集計・秘匿化・来歴検証 CLI の入力・出力・終了値。
- [実績の初期投入](tools/initial-achievement-import.md): 定義・移行根拠を投入する command の入口と入力の出所。

## 正本の役割

| 文書 | 所有する判断 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 横断する判断と並列作業、文脈の選び方、作業境界、検証と完了（PR / Linear の入口を含む） |
| 要求（`requirements/`） | 目的、適用範囲、正常 / 失敗時の結果、受入条件。画面固有の目的・順序・指標（例外: [UI 規約の画面固有の要求](ui-rule.md#画面固有の要求) が正本とする2項目） |
| [ドメイン規約] | 用語、不変条件、状態遷移、識別子の意味 |
| [アーキテクチャ] | システム境界、依存方向、資源境界、script / tool の配置、runtime / security |
| [API 規約] | wire、bootstrap、usecase / repository、transaction と wake、error / auth |
| [Web 実装規約] | 層、server state、React の更新境界、lifecycle / motion、form / API client、実装入口の名前 |
| [Worker 規約] | parent / child、runtime / listener / shutdown、資源予約、分析公開、OCR の役割、通知の準備と送信 |
| [DB 規約] | 所有権、永続状態、consumer contract、DB contract evidence、migration、移行中の契約 |
| [OCR job 契約] | API と Worker の非同期 job 契約 |
| [UI 規約] | 意味表現、視覚階層、操作文法、文言、取得状態、4人の台帳、視覚レビューの観点、要求に正本がない画面固有の要求（明示した2項目） |
| [テスト・品質規約] | 品質証拠の採用・維持・削除、層と oracle、領域別 failure-mode catalog |
| [テスト実行設計] | test size、coverage、実行境界、cross-system contract、並列性、CI artifact |
| [開発作業規約] | 環境、ローカル起動、E2E suite、コマンド、変更 gate、並列実行、Git |
| [CI・リリース規約] | CI 分類、候補と来歴、配備、分析昇格、credential rotation、rollback 検証 |
| [公開運用規約] | 本番操作の承認境界 |
| [ポストモーテム方針]・[教訓カード] | 公開範囲と、該当する変更で思い出す条件 |
| `schemas/*.schema.json` | OCR / 分析の wire 契約の shape・limit |

複数文書にまたがる契約は次の分担で置き、他の文書は入口の短い結論と参照に絞る。

| 契約 | 分担 |
| --- | --- |
| Discord 通知 | 何を・いつ通知するか: [基本要求の Discord通知設定](requirements/base.md#34-discord通知設定)、[分析 batch 要求の分析完了通知](requirements/series-analysis-batch.md#分析完了通知)。transaction・lock・gate・SAVEPOINT の順序: [DB 規約](db-rule.md#consumer-contract)。設定 command: [API 規約](api-rule.md#transaction--job-wake)。envelope・時間予算・sender: [Worker 規約](worker-rule.md#notifications)。共有 wire と consumer 間の排他: 対象 `momo-db` checkout の `docs/discord-notifications.md` |
| identity（legacy / canonical） | 保存 ID の契約と実行時の schema 検査: [DB 規約の Identifiers and Decoding](db-rule.md#identifiers-and-decoding)。起動時の mode 判定: [API 規約の Bootstrap](api-rule.md#bootstrap--http-execution)。legacy 境界の証拠: [テスト実行設計](test-architecture.md#api--worker-の実行境界) |
| 分析の version・artifact・公開 | 意味と要求: [分析 batch 要求]。lock 順・staging・不変性: [DB 規約]。validator と publication: [Worker 規約](worker-rule.md#analysis-publication-and-release-control)。bounded read: [API 規約](api-rule.md#wire-boundary) |
| 分析 release singleton と promotion | 要求: [分析 batch 要求の Compatibility](requirements/series-analysis-batch.md#8-compatibility--release--rollback)。lock 順: [DB 規約]。controller: [Worker 規約]。配備後の自動判定: [CI・リリース規約](release.md#analysis-promotion-and-backfill) |
| 固定メンバーの順序と4色 | 意味: [UI 規約](ui-rule.md#色面境界) と [4人の共通結果台帳](ui-rule.md#4人の共通結果台帳)。実装の正本: [Web 実装規約の実装入口](web-rule.md#implementation-entry-points) |

## 正本と証拠

- 現行の型・値・挙動はコード・schema・設定で確認する。test・fixture・生成物・report の扱いは [テスト・品質規約の証拠モデル](test-rule.md#証拠モデルと正本) に従う。コマンド・provider 固有手順は実行側へ置く。
- `docs/schemas/*.schema.json` は OCR / 分析の wire 契約。共有 fixture は専門正本が canonical と明示した具体例だけを正本とする。`apps/api/openapi.yaml` と Web 生成型は Tapir の派生物であり、意味は Tapir 側で定める。
- 完全な条件と例外は一つの正本へ置き、入口は適用条件・短い結論・詳細章への参照に絞る。教訓カードは該当時の再確認用であり、恒久ルールは専門正本に置く。component・class・env 名などの現在値は実装を正本とし、文書は役割と契約を書く。主要な名前の対応は [Web 実装規約の実装入口](web-rule.md#implementation-entry-points) のように入口の表へまとめ、判断に必要な名前は実装を直接参照してよい。全実装名の表への登録は求めない。
- lint・型・schema・生成物照合・checker が直接検出する規則の一覧や現在値は、設定・実装に一元化する。機械検査があっても、その規則を採用した目的、検査が届かない固有の意味、利用者が使う入口は文書に残してよい。設定のコメントが目的を説明している場合は、文書から設定へ辿れるようにする。

## 文書の増減と保守

- 公開範囲・private の参照条件は [AGENTS.md](../AGENTS.md#作業境界)、本番操作は [公開運用規約] に従う。要求・仕様・再利用する規約は各正本へ、継続判断に必要な計画・調査・履歴だけを `private/` へ置く。
- 説明・記録は既存の章やコードで足りない場合に加え、正本性のない写しは削除する。独立して読む作業があり、条件と例外を保って参照負担を減らせる場合だけ分割する。tool 固有の文書は実装に隣接させ、隣接する README を持たない tool は `docs/tools/` に置く。
- 移行中の契約は、撤去条件を添えて [DB 規約の Transitional Contracts](db-rule.md#transitional-contracts) のように恒久の契約とは別の節に置く。一時的な契約が恒久の契約に紛れることと、移行済みと推定して早期に撤去し共有 DB や旧 consumer を壊すことの両方を避けるためである。撤去は古い名称ではなく本番の状態と全 consumer の切替で判断し、それらを確認してから行う。切替手順を撤去するときも、その間に整えた恒久の検査・不変性・証拠は残す。
- 教訓を残す前に、既存の実装や規約で何が不足していたか、新しい対策が維持に見合うかを判断する。恒久ルールが必要なら専門正本へ置き、[教訓カード] には思い出す条件と確認事項だけを残す。同じ教訓は一か所にまとめ、単発の失敗から得た手順は該当する変更に限って適用する。事故固有の経緯・影響・残リスクは `private/post-mortem/` に置く。
- AGENTS は横断する判断と固有の境界、専門規約は対象の契約、skill は特定作業の知識を持つ。適用条件・守る結果・完了条件を簡潔に書き、モデルが判断できる一般論や単発の失敗から広げた義務を削る。固定順序・全文確認は権限・データ保全・互換性などの理由がある箇所に限る。
- skill の description は依頼を識別する内容に絞り、本文は共通制約と依頼別の参照先を示す。レビュー・記録・実装で成果物を分け、必須にする資料とテンプレート項目は依頼に応じて選ぶ。
- モデルガイドはこの repository で変えるべき判断へ適用し、例文が必要な場合は原典を参照する。並列化は AGENTS と開発作業規約に集約し、モデル名・推論設定・ツール・agent 数は実行環境に任せる。
- 改訂時は参照・承認・成果物・終了の判断への影響を確認する。懸念がある場合は不具合修正、レビューのみ、承認済み作業など該当ケースで確かめ、文面点検と実際の agent 試行を区別する。文字列一致や試行件数を行動品質の証拠にしない。

参考: OpenAI の [AGENTS / skills 見直し指針](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) と [モデル別ガイド](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)。作業ごとの再読は不要。

[基本要求]: requirements/base.md
[システム要求]: requirements/system-design.md
[ドメイン規約]: domain-rule.md
[アーキテクチャ]: architecture.md
[API 規約]: api-rule.md
[Web 実装規約]: web-rule.md
[Worker 規約]: worker-rule.md
[UI 規約]: ui-rule.md
[DB 規約]: db-rule.md
[OCR job 契約]: ocr-job-contract.md
[分析 batch 要求]: requirements/series-analysis-batch.md
[レーダー要求]: requirements/series-player-radar.md
[開催詳細要求]: requirements/held-event-detail.md
[試合メモ要求]: requirements/match-note.md
[テスト・品質規約]: test-rule.md
[テスト実行設計]: test-architecture.md
[開発作業規約]: dev-rule.md
[CI・リリース規約]: release.md
[公開運用規約]: ops/README.md
[ポストモーテム方針]: post-mortem/README.md
[教訓カード]: post-mortem/lessons.md
