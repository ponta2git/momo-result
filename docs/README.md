# 文書索引

## 1. 変更対象から読む

次表は正本と実装入口を探すための索引である。変更する契約に関係する章を選び、複数の行に該当しても共通の参照は一度扱う。対象が分かっている作業で索引から読み直す必要はない。

検証方針を決める場合は `docs/test-rule.md` の「品質証拠の採用・維持・削除」と変更に関係する evidence catalog、実行する gate を選ぶ場合は `docs/dev-rule.md` の「Change Gates」を参照する。test の size、実行構成、parallelism、coverage、report を変更する場合だけ `docs/test-architecture.md` を加える。

| 変更 | 要求・専門規約 | 条件付きで加える章 | 実装入口・固有の検証境界 |
| --- | --- | --- | --- |
| 業務要件 / CSV / TSV | `docs/requirements/base.md` | 用語・状態は `docs/domain-rule.md` | 対象 usecase / export |
| 技術構成 / 非機能 | `docs/requirements/system-design.md` | 構造は `docs/architecture.md`、運用は `docs/ops/README.md` | 設定・runtime 定義、変更した実行境界 |
| Web | 対象画面の要求、`docs/architecture.md` の Web | 表示・操作は `docs/ui-rule.md`、wire は API / Wire Boundary | `apps/web/src/`、Web Evidence Catalog |
| UI / UX / デザインシステム / 文章 / IA | 対象画面の要求、`docs/ui-rule.md` の該当章 | 用語は `docs/domain-rule.md`、実装境界は architecture の Web | styles.css、shared/ui、formatter、対象 component。UI規約の検証と UI Conformance |
| API / usecase | `docs/architecture.md` の API、対象要求 | 状態は domain、DB は db-rule、配送は対象 queue 契約 | Tapir endpoint、`apps/api/`、API Evidence Catalog |
| Discord通知設定 | `docs/requirements/base.md` の Discord通知設定、`docs/db-rule.md` | 共有consumer契約は `../momo-db/docs/discord-notifications.md` | NotificationSettings、管理画面、設定と取消のDB transaction |
| DB / repository | `docs/db-rule.md`、対象の業務・job 要求 | momo-db 側の変更は `AGENTS.md` の事前確認条件と `docs/db-rule.md` の Migration / Deployment | pinned migration、対象 query、変更経路の DB quality |
| OCR / Redis queue | `docs/redis-streams-ocr-contract.md`、`docs/db-rule.md`、`docs/schemas/ocr-*.schema.json` | worker 構造は architecture の OCR Capability / Worker Role | API producer、`apps/processing-worker/`、queue / DB / process の変更境界 |
| 分析 job / artifact / worker / API | `docs/requirements/series-analysis-batch.md` | DB は db-rule、構造は architecture、表示は ui-rule、指標・review は対象要求 | artifact / queue schema、Tapir、processing-worker、Web。Analysis Capability / Worker Evidence Catalog |
| 戦績比較 | `docs/requirements/series-comparison.md`、分析 batch 要求 | review は `docs/requirements/series-review-playbook.md`、UI は ui-rule | artifact schema、worker、Web、analysis / Web gate |
| 開催一覧・詳細 | `docs/requirements/held-event-detail.md` | 業務前提は base、メモは match-note、実装境界は architecture | 対象 API / Web |
| 試合メモ | `docs/requirements/match-note.md` | 変更する境界に応じて base、開催詳細、分析 batch、domain、UI | Tapir、momo-db、API / Web、DB と UI の変更経路 |
| テスト / coverage / CI | `docs/test-rule.md`、`docs/dev-rule.md` | 実行設計は test-architecture、契約の意味は専門正本 | test 設定、workflow、対象経路の証拠 |
| ローカル起動 / コマンド / Git | `docs/dev-rule.md` の該当章 | テスト選択は test-rule | package manifest、build 設定、script、workflow |
| インシデント / 重大なミス / 対策の再評価 | `.agents/skills/postmortem/SKILL.md` | 実装は変更対象の行。個別記録・台帳は参照を許可された場合だけ | スキルの完了条件と対象 gate |
| 規約 / repository skill | 本書の「正本と証拠」「規約・skill の保守」、変更対象の正本 | 起動条件・参照先・完了条件が他の入口と整合するか | 対象文書・skill と参照元、Change Gates の docs only |
| 文書のみ | 変更対象の正本 | 挙動を記述・変更する場合は対応する実行経路と教訓カード | Change Gates の docs only |

`base`、`ui-rule` などの略記は `docs/requirements/base.md`、`docs/ui-rule.md` など同名の文書を指す。索引から本文の意味を推測せず、判断する契約の章を読む。現行挙動の相違・必要な質問は `AGENTS.md` に従って解消する。

品質証拠は、要求・契約から守る結果を特定し、test-rule で境界と oracle を選び、必要なら test-architecture で実行設計を決め、dev-rule の gate と command へ割り当てる。既存 test や checker から逆向きに要求を作らない。

## 2. 正本と証拠

- 要求は利用者の目的、適用範囲、正常・失敗時の結果、受入条件を定める。順序自体が成功条件なら残し、コマンドや provider 固有手順は実行側へ置く。
- architecture は責務と依存方向、domain は用語と不変条件、DB / queue 契約は境界で守る条件、UI 規約は意味と操作の一貫性を所有する。
- コード・schema・設定は現行の型・値・実行契約の確認先。test、fixture、snapshot、lint、checker、coverage、report は宣言した範囲の証拠であり、成功を範囲外の保証へ広げない。
- `docs/schemas/*.schema.json` は OCR / 分析の wire 契約。共有 fixture は専門正本が canonical と明示した具体例だけを正本とする。`apps/api/openapi.yaml` と Web 生成型は Tapir 由来の派生物であり、手編集で意味を定めない。
- 一つの契約の完全な条件は一つの正本へ置く。作業の入口には短い結論と詳細章への参照を置いてよい。要約が扱えない例外は詳細章へ進む条件を示し、別の規則を作らない。
- `docs/post-mortem/lessons.md` は該当時の再確認用であり、恒久ルールの置き場にしない。

## 3. 公開範囲と文書の増減

公開範囲は `AGENTS.md`、公開運用原則は `docs/ops/README.md` に従う。private の計画・測定・履歴は、参照を許可された作業で適用対象と現行判断先を確認して使う。

文書を分割するのは、独立して読む作業があり、条件と例外をまとめたまま参照負担を減らせる場合。まず既存の章を整理する。正本性のない写しや判断に寄与しない説明は削除し、移動・統合時は入口と参照先を同じ変更で更新する。

### 規約・skill の保守

- `AGENTS.md` は作業全体に効く判断と固有の制約、専門規約は対象の契約、skill は特定作業の知識・手順を持つ。詳細は所有する正本へ置き、入口には適用条件と参照先を残す。
- 指示は守る結果、適用条件、完了条件を明確にする。固定順序や全文確認は、権限・データ保全・互換性など順序を崩すと具体的な問題が生じる箇所に残す。一般的な作業能力の説明や一件の失敗への対策を、すべての作業に適用する規則へ広げない。
- skill の description は何ができ、どの依頼で使うかを短く示す。単なる用語の一致で通常作業を専門レビューへ誘導せず、複数の作業モードに固有の詳細は条件付きで参照する。特定モデルの癖やツールの一時的な既定値を repository の恒久ルールにしない。
- 改訂時は、実際に想定する依頼で必要な参照・承認・検証・終了を判断できるか確認する。適用するケースに加え、誤字修正、通常の不具合修正、承認済み作業など誤って手順を増やしやすいケースも選ぶ。実際のエージェント挙動を試していない場合は、文面の点検と区別する。

参考: OpenAI の [skills / AGENTS.md の見直し](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) と [モデル別 prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)。本書はそれらを踏まえた repository の保守方針であり、作業ごとの再読を要求しない。
