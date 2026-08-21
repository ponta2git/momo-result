# AI Document Index

目的: public repository で安全に読める文書だけを入口化し、AI の探索量、重複読解、公開リスクを抑える。

## 1. AIの読み方と到達条件

最初に読むのは `AGENTS.md` とこの文書だけにする。次に変更対象を一つ以上のスコープへ絞る。
`第一読` は入口、`必読` は実装前に必ず読む正本、`条件付き` は列の条件が成立したときだけ読む正本である。
`実行正本` は現在の型・設定・挙動を決めるコード、schema、生成物であり、文書中の写しより優先する。

| スコープ | 第一読 | 必読 | 条件付き | 実行正本 | 検証先 |
| --- | --- | --- | --- | --- | --- |
| 業務要件 / CSV / TSV | `docs/requirements/base.md` | — | 用語・状態遷移は `docs/domain-rule.md` | — | 対象実装の規約 |
| 技術構成 / 非機能 | `docs/requirements/system-design.md` | — | 実装境界は `docs/architecture.md`、公開運用原則は `docs/ops/README.md` | 対象の設定・runtime定義 | `docs/test-rule.md`, `docs/dev-rule.md` |
| web | `docs/architecture.md` の Web | `docs/test-rule.md`, `docs/dev-rule.md` | UIは `docs/ui-rule.md`、API境界は `docs/architecture.md` の API | `apps/web/src/`, `apps/web/scripts/` | `docs/test-rule.md` の Web 規則 |
| Web UI / UX / デザインシステム | `docs/requirements/design-system.md` | `docs/ui-rule.md`, `docs/test-rule.md`, `docs/dev-rule.md` | UI文字列は `docs/requirements/writing-guidelines.md`、対象画面の要求、Web構成は architecture | `apps/web/src/styles.css`, `shared/ui`, UI checker | UI規約の検証章、Web test / Playwright |
| UI文字列 / UX Writing / 日本語表記 | `docs/requirements/writing-guidelines.md` | 対象画面の要求正本 | UI実装は `docs/ui-rule.md`、用語は `docs/domain-rule.md` | 対象UIと writing test | `docs/test-rule.md` |
| 製品横断の Product Experience / IA | `docs/requirements/product-experience.md` | 対象画面の要求正本 | design system、`docs/ui-rule.md`、`docs/domain-rule.md`、該当カードの lessons | 対象route / component | `docs/test-rule.md` |
| API / usecase | `docs/architecture.md` の API | `docs/test-rule.md`, `docs/dev-rule.md` | 業務意味は `docs/domain-rule.md`、DBは `docs/db-rule.md`、OCR queueは Redis契約、分析は実現仕様 | Tapir endpoint、`apps/api/openapi.yaml`、API source | API規則と変更gate |
| DB / repository | `docs/db-rule.md` | `docs/test-rule.md`, `docs/dev-rule.md` | 業務意味は domain、OCR queueは Redis契約、分析は実現仕様 | `../momo-db` migration、repository、`DbContractSpec` | DB-backed API / worker gate |
| Redis / OCR queue | `docs/redis-streams-ocr-contract.md` | OCR JSON Schema、`docs/db-rule.md`, `docs/test-rule.md`, `docs/dev-rule.md` | OCR role境界は architecture | `docs/schemas/ocr-*.schema.json`、Scala/Rust contract test | Redis wire / control-plane gate |
| OCR capability / worker role | `docs/architecture.md` の OCR Capability / Worker Role | Redis契約、`docs/test-rule.md`, `docs/dev-rule.md` | DB前提は `docs/db-rule.md` | `apps/processing-worker/`、OCR schema | worker / OCR control-plane gate |
| Analysis capability / worker role / job / artifact / API | `docs/series-analysis-realization.md` | `docs/requirements/series-analysis-batch.md`, `docs/test-rule.md`, `docs/dev-rule.md` | DBは `docs/db-rule.md`、構成は architecture、UIは `docs/ui-rule.md`、指標・reviewは該当要求 | artifact / queue schema、`apps/api/openapi.yaml`、`apps/processing-worker/`、Web checker | analysis contract / control-plane / UI gate |
| テスト / coverage / CI | `docs/test-rule.md` | `docs/dev-rule.md` | coverage / CI設計は `docs/test-architecture.md`、境界契約は各正本 | test config、workflow、test source | 変更gate |
| ローカル起動 / コマンド / Git | `docs/dev-rule.md` | — | テスト選択は `docs/test-rule.md` | package manifest、CI workflow、script | 対象の変更gate |
| 戦績比較ページ | `docs/requirements/series-comparison.md` | `docs/requirements/series-analysis-batch.md`, `docs/series-analysis-realization.md` | reviewは `docs/requirements/series-review-playbook.md`、UIは `docs/ui-rule.md` | OpenAPI、artifact schema、Web source | analysis / Web gate |
| 開催一覧・開催詳細 | `docs/requirements/held-event-detail.md` | — | base、architecture、test-rule | 対象API / Web source | 対象変更gate |
| docs 変更 | この文書 | 変更対象の正本、`docs/post-mortem/lessons.md` | 要求・運用の文書は変更対象に含むときだけ | 参照先のコード・schema・設定 | `git diff --check`, `pnpm public:safety:check` |

AIは実装前に、(1) その規則のowner、(2) 必読と発火した条件付き依存、(3) 実行正本、(4) 検証先を特定する。
この4点が特定できなければ、全文検索で推測を補わず、入口表または正本文書の導線を直す。正本文書間の矛盾は実装前に人間へ確認する。

長い要求仕様は、まず目次と該当章だけ読む。既に読んだ文書は再読せず、ファイル名と要点を再利用する。

## 2. AI到達性の受入ケース

次のケースで、`AGENTS.md` と本書だけから「第一読 → 必読依存 → 実行正本 → 検証先」へ到達できることを保つ。
この表は実装規約の導線を評価するもので、要求・運用文書全体の網羅性を主張しない。

| 変更したいこと | 到達すべき最初の正本 | 必ず特定する境界 |
| --- | --- | --- |
| API endpoint / usecase | architecture の API | Tapir / OpenAPI、業務・DB・queue依存、API gate |
| DB consumer | DB利用規約 | `momo-db` migration、repository、`DbContractSpec`、実PostgreSQL gate |
| OCR queue delivery | Redis Streams Contract | v2 schema、DB outbox、ACK、Redis integration gate |
| 分析job / lease / outbox | 戦績分析実現仕様 | DB state、queue schema、slot / fence、control-plane gate |
| 分析artifact / 読み取りAPI | 戦績分析実現仕様 | artifact schema、OpenAPI、pinning / bounded read、API / Web gate |
| 分析画面 / match context | 戦績分析実現仕様 | Web計算境界、status / artifact切替、UI規約、static checker |
| 共通UI | UI規約 | design-system要求、shared UI / token、UI checker / Playwright |
| テスト選択・docs変更 | テスト規約 / 本書 | 実行コマンド、対象契約、docs-only gate |

## 3. 文書の責務

| 種別 | ファイル | 責務 |
|---|---|---|
| 索引 | `docs/README.md` | 読む順、文書境界、public/private境界 |
| 要求正本 | `docs/requirements/base.md` | 業務要件、MVP範囲、CSV/TSV列順 |
| 要求正本 | `docs/requirements/system-design.md` | 技術構成、非機能、運用方針の高レベル要求 |
| 要求正本 | `docs/requirements/series-comparison.md` | 戦績比較ページの要求、指標、API方針 |
| 要求正本 | `docs/requirements/series-analysis-batch.md` | 戦績分析の非同期ジョブ、成果物、状態表示、管理、正確性、OCR統合制約 |
| 要求正本 | `docs/requirements/series-review-playbook.md` | 戦績比較ページ内の振り返り、行動プレイブック要求 |
| 要求正本 | `docs/requirements/held-event-detail.md` | 開催一覧、開催詳細、試合記録・戦績比較への導線 |
| 実装正本 | `docs/architecture.md` | API / web / Processing Worker runtime、OCR / 戦績分析能力の構造、依存方向、実装規約 |
| 戦績分析実現正本 | `docs/series-analysis-realization.md` | 戦績分析のjob、queue、artifact、API schema、Web計算境界、IA / UX / UI、切替・検証契約 |
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

## 4. 正本の分け方

- 要求文書は「何を満たすか」を書く。実装手順、テストコマンド、provider固有手順は置かない。
- `docs/architecture.md` は「どう実装するか」を書く。DB schema の所有権、Redis payload の詳細、テストコマンドは専用文書へ寄せる。
- `docs/test-rule.md` は「何を検証するか」を書く。coverage値やCI artifactの管理は `docs/test-architecture.md`、実行コマンドは `docs/dev-rule.md` へ寄せる。
- `docs/post-mortem/lessons.md` は「いつ何を問い直すか」だけを書く。恒久ルールや実装規約の置き場にしない。
- 実装コード、生成物、設定ファイルにしかない詳細を文書へ写す場合は、重複管理に見合う判断ルールだけを残す。

## 5. Public / Private 境界

- `docs/` は public 前提。secret、provider token、DB/Redis URL、origin lock token、session / CSRF token、OAuth token、実測ログ、攻撃対策の詳細手順を置かない。
- 詳細 runbook、provider 設定、個別 postmortem、実装計画、一時メモは git 管理外の `private/` に置く。
- AI は通常探索で `private/` を読まない。ユーザーが明示し、作業上必要な場合だけ読む。
- `fly.toml` に CD に必要な app / service / health check などの非 secret 設定が出ることは許容する。ただし docs 側で本番 topology や攻撃面を重複説明しない。

## 6. 文書の増減判断

新規文書を作る条件:

- 複数の正本文書に同じ判断ルールが3回以上現れる。
- 変更時に読むべき対象が明確に分かれ、既存文書へ置くと読む条件が曖昧になる。
- public に置ける抽象ルールだけで完結し、secret や攻撃手順を含まない。

既存文書を統合・削除する条件:

- 読む条件が別文書と同じで、独自の正本性がない。
- 実装コードや設定ファイルの値を写しているだけで、判断ルールがない。
- private に置くべき運用詳細や検討メモになっている。

現時点の判断:

- `docs/test-rule.md` と `docs/test-architecture.md` は分けて維持する。前者は日々のテスト選択、後者はcoverage/CI設計を扱う。
- runtime / deploy の公開可能な判断ルールは `docs/requirements/system-design.md`、`docs/architecture.md`、`docs/dev-rule.md`、`docs/test-architecture.md` で管理する。人間向けの具体的な通常release、Analysis昇格、rollback手順はgit管理外の `private/ops/runbook.md`、初回構築は `private/ops/production-deploy.md` を正とし、provider固有値をpublic docsへ複製しない。
- `docs/requirements/future-work.md` は要求棚卸しとして維持する。具体的な実装計画や運用手順が増える場合は `private/` へ移す。

## 7. 競合時の優先順位

1. 実装コード、設定ファイル、生成物の現在状態
2. 正本文書
3. 補助文書
4. private の計画・メモ
5. 過去の会話や古い一時メモ

正本文書同士が矛盾する場合、実装前に人間へ確認する。補助文書が正本文書と矛盾する場合は、補助文書を直す。
