# AI Document Index

目的: public repository で安全に読める文書だけを入口化し、AI の探索量と公開リスクを抑える。

## 原則

- 最初に読むのはこの文書と `AGENTS.md`。
- 変更対象に一致する文書だけ読む。`docs/` 全体を一括で読まない。
- 正本、補助、計画、運用原則を混同しない。
- `private/` は git 管理外のローカル領域。ユーザーが明示し、作業上必要な場合だけ読む。
- secret、provider token、DB/Redis URL、origin lock token、実測ログ、攻撃対策の詳細手順は public docs に置かない。
- `fly.toml` に CD に必要な app / service / health check などの非 secret 設定が出ることは許容する。ただし docs 側で本番 topology や攻撃面を重複説明しない。

## トークン効率

- 文書を読む前に、変更対象を `web`、`api`、`ocr-worker`、`DB`、`Redis/OCR queue`、`ops`、`tests`、`docs` のどれかへ絞る。
- 各文書の先頭にある「読む条件」を見て、該当しない文書は開かない。
- 背景や検討履歴ではなく、正本と現在の実装コードを優先する。
- 長い要求仕様は、まず目次と該当章だけ読む。
- postmortem は個別詳細ではなく、原則として `docs/post-mortem/lessons.md` の該当カードだけ読む。
- 既に読んだ内容は再読せず、必要ならファイル名と要点だけ思い出して使う。

## 文書マップ

| 種別 | ファイル | 読む条件 |
|---|---|---|
| 正本 | `docs/requirements/base.md` | 業務要件、MVP範囲、CSV/TSV列順を判断する |
| 正本 | `docs/requirements/system-design.md` | 技術構成、非機能、運用方針の高レベル判断をする |
| 正本 | `docs/requirements/series-comparison.md` | 戦績比較ページを実装・変更する |
| 正本 | `docs/architecture.md` | API / web / OCR worker の構造、依存方向、実装規約を判断する |
| 正本 | `docs/domain-rule.md` | 試合、下書き、OCR、認証主体、マスタ、開催回の意味を判断する |
| 正本 | `docs/db-rule.md` | DB table / column / migration 前提、PostgreSQL repository を触る |
| 正本 | `docs/redis-streams-ocr-contract.md` | OCR queue、Redis Streams、outbox、worker ack を触る |
| 正本 | `docs/schemas/*.schema.json` | Redis payload / OCR hints の JSON Schema を変更する |
| 正本 | `docs/test-rule.md` | テスト選択、再発防止、品質ゲートを判断する |
| 補助 | `docs/test-architecture.md` | coverage、CI artifact、テストサイズを判断する |
| 正本 | `docs/dev-rule.md` | 起動、検証コマンド、Git運用を確認する |
| 補助 | `docs/post-mortem/lessons.md` | 完了前に過去障害の該当カードを確認する |
| 公開運用原則 | `docs/ops/README.md` | public repo に置ける運用ルールだけ確認する |

## Private Documents

詳細 runbook、provider 設定、攻撃対策、個別 postmortem、実装計画、一時メモは `private/` 配下に置く。
`private/` は public repository に commit しない。AI は通常探索で `private/` を読まない。

## 競合時の優先順位

1. 実装コードと生成物の現在状態
2. 正本文書
3. 補助文書
4. private の計画・メモ
5. 過去の会話や古い一時メモ

正本文書同士が矛盾する場合は、実装前に人間へ確認する。
