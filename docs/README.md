# 文書索引

## 変更対象から読む

変更に関係する行から必要な章へ進む。共通の参照は重複して読まない。

品質証拠は [テスト・品質規約] の採用基準と対象 catalog、必須 gate とコマンドは [開発作業規約] で選ぶ。test の size・実行構成・並列性・coverage・report を変更する場合だけ [テスト実行設計](test-architecture.md) を加える。

| 変更対象 | 正本・条件付き参照 | 実装入口 |
| --- | --- | --- |
| 業務要件 / CSV / TSV | [基本要求]、用語・状態は [ドメイン規約] | 対象 usecase / export |
| ログイン / ロール / 認可 | [基本要求] の認証・権限。分析操作は [分析 batch 要求]・[レーダー要求]、DB は [DB 規約] | 認証主体、API guard、アカウント管理、Web の権限制御 |
| 技術構成 / 非機能 | [システム要求](requirements/system-design.md)。構造は [アーキテクチャ]、運用は [公開運用規約](ops/README.md) | 設定・runtime 定義 |
| Web / UI / UX / 文章 / IA | 対象画面の要求、[アーキテクチャ] の Web。表示・操作は [UI 規約]、wire は [Wire Boundary](architecture.md#wire-boundary)、用語は [ドメイン規約] | `apps/web/src/` の対象 component、styles.css、shared/ui、formatter |
| API / usecase | 対象要求、[アーキテクチャ] の API、状態は [ドメイン規約]、DB は [DB 規約] | `apps/api/`、Tapir endpoint、対象 job |
| Discord 通知設定 | [基本要求] の Discord通知設定、[DB 規約]。共有 consumer 契約は対象 `momo-db` checkout の `docs/discord-notifications.md` | NotificationSettings、管理画面、設定・取消の transaction |
| DB / repository | [DB 規約]、対象の業務・job 要求。`momo-db` 側の変更前には [AGENTS.md](../AGENTS.md#作業境界) の事前手順 | 対象 query、隔離 test 用の pinned migration |
| OCR job / scheduler | [OCR job 契約](ocr-job-contract.md)、[DB 規約]、`docs/schemas/ocr-*.schema.json`。worker 構造は [アーキテクチャ] の OCR Capability / Worker Role | API producer、`apps/processing-worker/` |
| 分析 job / artifact / worker / API | [分析 batch 要求]。DB は [DB 規約]、構造は [アーキテクチャ]、表示は [UI 規約]、指標は対象要求 | artifact / input schema、Tapir、processing-worker、Web |
| 戦績比較 | [比較要求](requirements/series-comparison.md)、[分析 batch 要求]。対象に応じ [オーナー別](requirements/series-owner-comparison.md)・[レーダー要求]・[見通し](requirements/series-rank-outlook.md)・[振り返り](requirements/series-review-playbook.md)、表示は [UI 規約] | artifact schema、worker、API / Web |
| 開催一覧・詳細 | [開催詳細要求]。業務前提は [基本要求]、メモは [試合メモ要求] | 対象 API / Web |
| 試合メモ | [試合メモ要求]。変更する境界に応じ [基本要求]、[開催詳細要求]、[分析 batch 要求]、[ドメイン規約]、[UI 規約] | Tapir、momo-db、API / Web |
| 実績リスト・初達成・実績軸 | [実績要求](requirements/player-achievements.md)。権限は [基本要求]、既存6軸は [レーダー要求]、再計算は [分析 batch 要求] | 試合登録・編集、リスト管理、専用ページ、レーダー |
| テスト / coverage / CI | [テスト・品質規約]、[開発作業規約]、実行構成を変える時は [テスト実行設計](test-architecture.md) | test 設定、workflow、対象経路 |
| ローカル起動 / コマンド / Git | [開発作業規約] の該当章 | package manifest、build 設定、script、workflow |
| ポストモーテムの作成 / レビュー / 対策の再評価 | [postmortem skill](../.agents/skills/postmortem/SKILL.md)。個別記録・台帳は参照許可がある場合だけ | 実装を伴う場合は変更対象の行 |
| 文書 / 規約 / repository skill | 変更対象の正本。規約・skill は本書の「正本と証拠」「規約・skill の保守」、挙動を扱う時は実行経路と [教訓カード](post-mortem/lessons.md) | 対象文書と参照元、起動・完了条件、docs only gate |

ツール固有の入力・結果の意味は実装に隣接する文書を参照する。

- [cgroup memory probe](../scripts/tools/cmd/cgroup-memory-probe/README.md): 隔離実験の合格条件と適用範囲。
- [Linux memory snapshot](../scripts/tools/linux-memory-snapshot.md): 診断値の単位、欠測、計測範囲。
- [Rust OCR evaluator](../scripts/tools/cmd/ocr-rust-evaluator/README.md): 校正用の精度比較と限界。
- [OCR evaluation audit](../scripts/tools/cmd/ocr-evaluation-audit/README.md): 標本の独立性と必要量。

## 正本と証拠

- 要求は目的・適用範囲・正常/失敗時の結果・受入条件を、architecture は責務と依存方向、domain は用語と不変条件、専門規約は各境界の契約を所有する。コマンド・provider 固有手順は実行側へ置く。
- 現行の型・値・挙動はコード・schema・設定で確認する。test・fixture・生成物・report は宣言した範囲の証拠であり、そこから要求を作ったり保証範囲を広げたりしない。
- `docs/schemas/*.schema.json` は OCR / 分析の wire 契約。共有 fixture は専門正本が canonical と明示した具体例だけを正本とする。`apps/api/openapi.yaml` と Web 生成型は Tapir の派生物であり、手編集で意味を定めない。
- 完全な条件と例外は一つの正本へ置き、入口は適用条件・短い結論・詳細章への参照に絞る。教訓カードは該当時の再確認用であり、恒久ルールを重ねて置かない。

## 公開範囲と文書の増減

公開範囲・private の参照条件は [AGENTS.md](../AGENTS.md)、本番操作は [公開運用規約](ops/README.md) に従う。要求・仕様・再利用する規約は各正本へ、継続判断に必要な計画・調査・履歴だけを `private/` へ置く。

既存の章やコードで足りる説明・記録は増やさず、正本性のない写しは削除する。独立して読む作業があり、条件と例外を保って参照負担を減らせる場合だけ分割する。移動・統合時は参照元も更新する。

### 規約・skill の保守

- AGENTS は横断する判断と固有の境界、専門規約は対象の契約、skill は特定作業の知識を持つ。適用条件・守る結果・完了条件を簡潔に書き、モデルが判断できる一般論や単発の失敗から広げた義務を削る。固定順序・全文確認は権限・データ保全・互換性などの理由がある箇所に限る。
- skill の description は依頼を識別する内容に絞り、本文は共通制約と依頼別の参照先を示す。レビュー・記録・実装で成果物を分け、全資料やテンプレート全項目を一律必須にしない。
- モデルガイドはこの repository で変えるべき判断へ適用し、例文を転載しない。並列化は AGENTS と開発作業規約に集約し、モデル名・推論設定・ツール・agent 数は実行環境に任せる。
- 改訂時は参照・承認・成果物・終了の判断への影響を確認する。懸念がある場合は不具合修正、レビューのみ、承認済み作業など該当ケースで確かめ、文面点検と実際の agent 試行を区別する。文字列一致や試行件数を行動品質の証拠にしない。

参考: OpenAI の [AGENTS / skills 見直し指針](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) と [モデル別ガイド](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)。作業ごとの再読は不要。

[基本要求]: requirements/base.md
[ドメイン規約]: domain-rule.md
[アーキテクチャ]: architecture.md
[UI 規約]: ui-rule.md
[DB 規約]: db-rule.md
[分析 batch 要求]: requirements/series-analysis-batch.md
[レーダー要求]: requirements/series-player-radar.md
[開催詳細要求]: requirements/held-event-detail.md
[試合メモ要求]: requirements/match-note.md
[テスト・品質規約]: test-rule.md
[開発作業規約]: dev-rule.md
