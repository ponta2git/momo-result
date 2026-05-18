# AGENTS.md

## 1. 文書マップ

分析済みの内容は再利用し、不要な文書の再読はしない。不明点はユーザーに確認する。**必要な文書だけを読む。全ドキュメントを事前に一括で読まない。**

| ファイル | 内容 |
|---|---|
| `docs/requirements/base.md` | 業務要件・制約・CSV/TSV列順（正本） |
| `docs/requirements/system-design.md` | 技術要件・外部システム・非機能要件 |
| `docs/architecture.md` | 実装規約（スタック・API設計・web/OCR規約・セキュリティ） |
| `docs/db-rule.md` | DB共有ルール・マイグレーション方針 |
| `docs/domain-rule.md` | ドメイン用語・試合記録の確定条件・フロー |
| `docs/redis-streams-ocr-contract.md` | Redis Streams / OCR queue / outbox / worker ack 契約（正本） |
| `docs/schemas/ocr-queue-payload-v1.schema.json` / `docs/schemas/ocr-hints-v1.schema.json` | Redis Streams / OCR hints の JSON Schema 正本 |
| `docs/dev-rule.md` | ローカル開発・Git規約・検証コマンド |
| `docs/test-rule.md` | テスト実装方針・CI必須チェック項目 |
| `docs/post-mortem/lessons.md` | 過去障害から得た実装時チェック教訓 |
| 実装コード | 実際の実装詳細 |

---

## 2. 制約

- スコープが広がる場合は実行前に停止し、人間に確認する
- 規約以上の設計判断が必要な場合は必ず停止し、人間に確認する
- 計画は15タスク以内、多くて20タスク程度に収める
- 説明・報告は必要充分に構造化して行う
- 提案時はおすすめラインまたは次に取り組むべき一つを確定させる

---

## 3. 探索モード、計画検討の基本原則

- 観点を自分で包括的・徹底的に生成し、反芻する
   - 見落としやすい観点を優先する
- 依存関係と優先度を判断し、最重要事項を最大5つに収束させる
  - なぜ重要か、リスク、推奨対応（最大3つ）

---

## 4. 実装時の基本原則

- 必ず仕様を満たす実装を行う
   - 仕様の不明点、矛盾、穴を解消してから実装する（探索、人間に聞く）
- 場当たり的な対応は避け、可能な限り本質的な実装をする
   - 規約拡張の必要性がある場合は、人間に相談する
- 必要なタイミングでクオリティゲートを通過させる

---

## 5. 完了条件

- 実装が仕様を満たしている
- `docs/post-mortem/lessons.md` を確認し、該当する教訓を検証している
- クオリティゲート（format / lint / typecheck / test）が通る
- 主要な失敗ケースが考慮されている
