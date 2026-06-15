# AI Document Index

目的: public repository で安全に読める文書だけを入口化し、AI の探索量、重複読解、公開リスクを抑える。

## 1. 読み方

最初に読むのは `AGENTS.md` とこの文書だけにする。次に変更対象を一つ以上のスコープへ絞り、該当する行の文書だけ読む。

| スコープ | まず読む | 必要になったら読む |
|---|---|---|
| 業務要件 / CSV / TSV | `docs/requirements/base.md` | `docs/domain-rule.md` |
| 技術構成 / 非機能 | `docs/requirements/system-design.md` | `docs/architecture.md`, `docs/ops/README.md` |
| web | `docs/architecture.md` の Web | `docs/test-rule.md`, `docs/dev-rule.md` |
| API / usecase | `docs/architecture.md` の API | `docs/domain-rule.md`, `docs/test-rule.md`, `docs/dev-rule.md` |
| DB / repository | `docs/db-rule.md` | `docs/test-rule.md`, `docs/dev-rule.md` |
| Redis / OCR queue | `docs/redis-streams-ocr-contract.md` | `docs/schemas/*.schema.json`, `docs/test-rule.md` |
| OCR worker | `docs/architecture.md` の OCR Worker | `docs/redis-streams-ocr-contract.md`, `docs/test-rule.md` |
| テスト / coverage / CI | `docs/test-rule.md` | `docs/test-architecture.md`, `docs/dev-rule.md` |
| ローカル起動 / コマンド / Git | `docs/dev-rule.md` | `docs/test-rule.md` |
| 戦績比較ページ | `docs/requirements/series-comparison.md` | 振り返り/行動プレイブックを触る場合は `docs/requirements/series-review-playbook.md`、必要に応じて `docs/architecture.md`, `docs/test-rule.md` |
| docs 変更 | この文書 | 変更対象の正本、`docs/post-mortem/lessons.md` |

長い要求仕様は、まず目次と該当章だけ読む。既に読んだ文書は再読せず、ファイル名と要点を再利用する。

## 2. 文書の責務

| 種別 | ファイル | 責務 |
|---|---|---|
| 索引 | `docs/README.md` | 読む順、文書境界、public/private境界 |
| 要求正本 | `docs/requirements/base.md` | 業務要件、MVP範囲、CSV/TSV列順 |
| 要求正本 | `docs/requirements/system-design.md` | 技術構成、非機能、運用方針の高レベル要求 |
| 要求正本 | `docs/requirements/series-comparison.md` | 戦績比較ページの要求、指標、API方針 |
| 要求正本 | `docs/requirements/series-review-playbook.md` | 戦績比較ページ内の振り返り、行動プレイブック要求 |
| 実装正本 | `docs/architecture.md` | API / web / OCR worker の構造、依存方向、実装規約 |
| ドメイン正本 | `docs/domain-rule.md` | 用語、状態遷移、不変条件、認証主体と試合参加者の区別 |
| DB正本 | `docs/db-rule.md` | 共有DB所有権、migration前提、consumer contract |
| Queue正本 | `docs/redis-streams-ocr-contract.md` | Redis Streams、outbox、payload、ack / retry 契約 |
| Schema正本 | `docs/schemas/*.schema.json` | Redis payload / OCR hints の機械可読契約 |
| テスト正本 | `docs/test-rule.md` | 変更種別ごとのテスト選択、oracle、品質ゲート判断 |
| テスト補助 | `docs/test-architecture.md` | テストサイズ、coverage、CI artifact、段階計画 |
| 開発正本 | `docs/dev-rule.md` | toolchain、ローカル起動、コマンド、Git運用 |
| 最終確認 | `docs/post-mortem/lessons.md` | 作業完了前に該当カードだけ確認する再発防止チェック |
| 公開運用原則 | `docs/ops/README.md` | public repo に置ける運用原則 |

## 3. 正本の分け方

- 要求文書は「何を満たすか」を書く。実装手順、テストコマンド、provider固有手順は置かない。
- `docs/architecture.md` は「どう実装するか」を書く。DB schema の所有権、Redis payload の詳細、テストコマンドは専用文書へ寄せる。
- `docs/test-rule.md` は「何を検証するか」を書く。coverage値やCI artifactの管理は `docs/test-architecture.md`、実行コマンドは `docs/dev-rule.md` へ寄せる。
- `docs/post-mortem/lessons.md` は「いつ何を問い直すか」だけを書く。恒久ルールや実装規約の置き場にしない。
- 実装コード、生成物、設定ファイルにしかない詳細を文書へ写す場合は、重複管理に見合う判断ルールだけを残す。

## 4. Public / Private 境界

- `docs/` は public 前提。secret、provider token、DB/Redis URL、origin lock token、session / CSRF token、OAuth token、実測ログ、攻撃対策の詳細手順を置かない。
- 詳細 runbook、provider 設定、個別 postmortem、実装計画、一時メモは git 管理外の `private/` に置く。
- AI は通常探索で `private/` を読まない。ユーザーが明示し、作業上必要な場合だけ読む。
- `fly.toml` に CD に必要な app / service / health check などの非 secret 設定が出ることは許容する。ただし docs 側で本番 topology や攻撃面を重複説明しない。

## 5. 文書の増減判断

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
- runtime / deploy は現状 `docs/requirements/system-design.md`、`docs/architecture.md`、`docs/dev-rule.md`、`docs/test-architecture.md` で足りる。nginx / supervisord / Fly の変更が増え、判断ルールが重複し始めたら `docs/runtime-rule.md` を新設する。
- `docs/requirements/future-work.md` は要求棚卸しとして維持する。具体的な実装計画や運用手順が増える場合は `private/` へ移す。

## 6. 競合時の優先順位

1. 実装コード、設定ファイル、生成物の現在状態
2. 正本文書
3. 補助文書
4. private の計画・メモ
5. 過去の会話や古い一時メモ

正本文書同士が矛盾する場合、実装前に人間へ確認する。補助文書が正本文書と矛盾する場合は、補助文書を直す。
