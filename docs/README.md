# AI Document Index

## 1. 読み方と到達条件

最初に読むのは `AGENTS.md` とこの文書だけにする。次に変更対象を一つ以上のスコープへ絞る。
`第一読` は入口、`必読` は実装前に必ず読む正本、`条件付き` は列の条件が成立したときだけ読む正本である。
`実行正本` は現在の型・設定・挙動を決めるコード、schema、生成物であり、文書中の写しより優先する。
長い文書は、まず目次と該当章だけ読む。 *既に読んだ文書は再読せず、ファイル名と要点を再利用する。*

| スコープ | 第一読 | 必読 | 条件付き | 実行正本 | 検証先 |
| --- | --- | --- | --- | --- | --- |
| 業務要件 / CSV / TSV | `docs/requirements/base.md` | — | 用語・状態遷移は `docs/domain-rule.md` | — | 対象実装の規約 |
| 技術構成 / 非機能 | `docs/requirements/system-design.md` | — | 実装境界は `docs/architecture.md`、公開運用原則は `docs/ops/README.md` | 対象の設定・runtime定義 | `docs/test-rule.md`, `docs/dev-rule.md` |
| web | `docs/architecture.md` の Web | `docs/test-rule.md`, `docs/dev-rule.md` | UIは `docs/ui-rule.md`、API境界は `docs/architecture.md` の API | `apps/web/src/`, `apps/web/scripts/` | `docs/test-rule.md` の Web 規則 |
| Web UI / UX / デザインシステム | `docs/ui-rule.md` | `docs/test-rule.md`, `docs/dev-rule.md` | 対象画面の要求、Web構成は architecture、用語は domain | `apps/web/src/styles.css`, `apps/web/src/shared/ui/`, UI checker、対象component | `docs/ui-rule.md` の Verification、`docs/test-rule.md` の UI Conformance / Web test |
| UI文字列 / UX Writing / 日本語表記 | `docs/ui-rule.md` の Product Direction / Meaning と Orientation / Visual Hierarchy | 対象画面の要求正本 | 用語は `docs/domain-rule.md` | 対象UIと formatter / ViewModel | `docs/test-rule.md` |
| 製品横断の Product Experience / IA | `docs/ui-rule.md` の Product Direction / Meaning と Navigation / Finite Task Loop | 対象画面の要求正本 | 用語は `docs/domain-rule.md`、該当カードは lessons | 対象route / component | `docs/test-rule.md` |
| API / usecase | `docs/architecture.md` の API | `docs/test-rule.md`, `docs/dev-rule.md` | 業務意味は `docs/domain-rule.md`、DBは `docs/db-rule.md`、OCR queueは Redis契約、分析はbatch要求 | Tapir endpoint、`apps/api/openapi.yaml`、API source | API規則と変更gate |
| DB / repository | `docs/db-rule.md` | `docs/test-rule.md`, `docs/dev-rule.md` | 業務意味は domain、OCR queueは Redis契約、分析はbatch要求 | `../momo-db` migration、repository、`DbContractSpec` | DB-backed API / worker gate |
| Redis / OCR queue | `docs/redis-streams-ocr-contract.md` | OCR JSON Schema、`docs/db-rule.md`, `docs/test-rule.md`, `docs/dev-rule.md` | OCR role境界は architecture | `docs/schemas/ocr-*.schema.json`、Scala/Rust contract test | Redis wire / control-plane gate |
| OCR capability / worker role | `docs/architecture.md` の OCR Capability / Worker Role | Redis契約、`docs/test-rule.md`, `docs/dev-rule.md` | DB前提は `docs/db-rule.md` | `apps/processing-worker/`、OCR schema | worker / OCR control-plane gate |
| Analysis capability / worker role / job / artifact / API | `docs/requirements/series-analysis-batch.md` | `docs/test-rule.md`, `docs/dev-rule.md` | DBは `docs/db-rule.md`、構成は architecture、UIは `docs/ui-rule.md`、指標・reviewは該当要求 | artifact / queue schema、`apps/api/openapi.yaml`、`apps/processing-worker/`、Web checker | analysis contract / control-plane / UI gate |
| テスト / coverage / CI | `docs/test-rule.md` | `docs/dev-rule.md` | coverage / CI設計は `docs/test-architecture.md`、境界契約は各正本 | test config、workflow、test source | 変更gate |
| ローカル起動 / コマンド / Git | `docs/dev-rule.md` | — | テスト選択は `docs/test-rule.md` | package manifest、CI workflow、script | 対象の変更gate |
| 戦績比較ページ | `docs/requirements/series-comparison.md` | `docs/requirements/series-analysis-batch.md` | reviewは `docs/requirements/series-review-playbook.md`、UIは `docs/ui-rule.md` | OpenAPI、artifact schema、Web source | analysis / Web gate |
| 開催一覧・開催詳細 | `docs/requirements/held-event-detail.md` | — | base、architecture、test-rule | 対象API / Web source | 対象変更gate |
| 試合メモ | `docs/requirements/match-note.md` | — | base、held-event-detail、series-analysis-batch、domain、UI | OpenAPI、momo-db migration、API / Web source | API / DB / Web gate |
| docs 変更 | この文書 | 変更対象の正本、`docs/post-mortem/lessons.md` | 要求・運用の文書は変更対象に含むときだけ | 参照先のコード・schema・設定 | `git diff --check`, `pnpm public:safety:check` |

この表は実装規約の導線を評価するもので、要求・運用文書全体の網羅性を主張しない。

AIは実装前に、(1) その規則のowner、(2) 必読と発火した条件付き依存、(3) 実行正本、(4) 検証先を特定する。
この4点が特定できなければ、全文検索で推測を補わず、入口表または正本文書の導線を直す。正本文書間の矛盾は実装前に人間へ確認する。

## 2. 文書の責務, 正本

- 要求文書は「何を満たすか」を書く。実装手順、テストコマンド、provider固有手順は置かない。
- 実装コード、生成物、設定ファイルにしかない詳細を文書へ写す場合は、重複管理に見合う判断ルールだけを残す。

| 種別 | ファイル | 責務 |
| --- | --- | --- |
| 索引 | `docs/README.md` | 読む順、文書境界、public/private境界 |
| 要求正本 | `docs/requirements/base.md` | 業務要件、MVP範囲、CSV/TSV列順 |
| 要求正本 | `docs/requirements/system-design.md` | 技術構成、非機能、運用方針の高レベル要求 |
| 要求正本 | `docs/requirements/series-comparison.md` | 戦績比較ページの利用者体験、scope、指標の意味 |
| 要求正本 | `docs/requirements/series-analysis-batch.md` | 戦績分析のjob、queue、artifact公開、API / Web pinning、状態表示、管理、version・release・検証の横断要求 |
| 要求正本 | `docs/requirements/series-review-playbook.md` | 行動プレイブックの生成、選定、表現要求 |
| 要求正本 | `docs/requirements/held-event-detail.md` | 開催一覧、開催詳細、試合記録・戦績比較への導線 |
| 要求正本 | `docs/requirements/match-note.md` | 試合メモの入力、共有、更新、表示、分析・出力境界 |
| 実装正本 | `docs/architecture.md` | API / web / Processing Worker runtime、OCR / 戦績分析能力の構造、依存方向、実装規約 |
| UI正本 | `docs/ui-rule.md` | Web の意味表現、余白、操作、motion、状態表示、画面遷移の一貫性 |
| ドメイン正本 | `docs/domain-rule.md` | 用語、状態遷移、不変条件、認証主体と試合参加者の区別 |
| DB正本 | `docs/db-rule.md` | 共有DB所有権、migration前提、consumer contract |
| Queue正本 | `docs/redis-streams-ocr-contract.md` | Redis Streams、outbox、payload、ack / retry 契約 |
| Schema正本 | `docs/schemas/*.schema.json`, `docs/schemas/fixtures/` | Redis payload、OCR hints、戦績分析artifact / queueの機械可読契約と共有fixture |
| テスト正本 | `docs/test-rule.md` | 変更種別ごとのテスト選択、oracle、品質ゲート判断 |
| テスト補助 | `docs/test-architecture.md` | テストサイズ、coverage、CI artifact、段階計画 |
| 開発正本 | `docs/dev-rule.md` | toolchain、ローカル起動、コマンド、Git運用 |
| 最終確認 | `docs/post-mortem/lessons.md` | 作業完了前に該当カードだけ確認する再発防止チェック |
| 公開運用原則 | `docs/ops/README.md` | public repo に置ける運用原則 |

## 3. Public / Private 境界

- `docs/` は public 前提。secret、provider token、DB/Redis URL、origin lock token、session / CSRF token、OAuth token、実測ログ、攻撃対策の詳細手順を置かない。
- 詳細 runbook、provider 設定、個別 postmortem、実装計画、一時メモは git 管理外の `private/` に置く。
- AI は通常探索で `private/` を読まない。ユーザーが明示し、作業上必要な場合だけ読む。
- `fly.toml` に CD に必要な app / service / health check などの非 secret 設定が出ることは許容する。ただし docs 側で本番 topology や攻撃面を重複説明しない。

## 4. 文書の増減判断

以下の場合は、文書を新設する：

- 変更時に読むべき対象が明確に分かれ、既存文書へ置くと読む条件が曖昧になる。
- public に置ける抽象ルールだけで完結し、secret や攻撃手順を含まない。

以下の場合は、既存文書を統合・削除する:

- 正本性がない。
- 実装コードや設定ファイルの値を写しているだけで、判断ルールがない。
- private に置くべき運用詳細や検討メモになっている。
