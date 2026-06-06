# AGENTS.md

## 1. 文書マップ

分析済みの内容は再利用し、不要な文書の再読はしない。不明点はユーザーに確認する。**必要な文書だけを読む。全ドキュメントを事前に一括で読まない。**
最初に `docs/README.md` を見て、変更対象に必要な文書だけを選ぶ。

| ファイル | 内容 |
|---|---|
| `docs/README.md` | AI向け文書索引・public/private境界・トークン効率 |
| `docs/requirements/base.md` | 業務要件・制約・CSV/TSV列順（正本） |
| `docs/requirements/system-design.md` | 技術要件・外部システム・非機能要件 |
| `docs/requirements/series-comparison.md` | 戦績比較ページ要求仕様 |
| `docs/architecture.md` | 実装規約（スタック・API設計・web/OCR規約・セキュリティ） |
| `docs/db-rule.md` | DB共有ルール・マイグレーション方針 |
| `docs/domain-rule.md` | ドメイン用語・試合記録の確定条件・フロー |
| `docs/redis-streams-ocr-contract.md` | Redis Streams / OCR queue / outbox / worker ack 契約（正本） |
| `docs/schemas/ocr-queue-payload-v1.schema.json` / `docs/schemas/ocr-hints-v1.schema.json` | Redis Streams / OCR hints の JSON Schema 正本 |
| `docs/dev-rule.md` | ローカル開発・Git規約・検証コマンド |
| `docs/test-rule.md` | テスト実装方針・CI必須チェック項目 |
| `docs/test-architecture.md` | テストサイズ・coverage・CI artifact方針 |
| `docs/post-mortem/lessons.md` | 過去障害から得た実装時チェック教訓 |
| `docs/ops/README.md` | publicに置ける運用原則のみ |
| 実装コード | 実際の実装詳細 |

---

## 2. Public / Private 境界

- このリポジトリは public 前提。公開されると攻撃参考になる運用詳細、provider 設定、実測値、kill switch、個別障害詳細は `docs/` に置かない
- `private/` は git 管理外のローカル領域。ユーザーが明示し、作業上必要な場合だけ読む。通常探索・通常実装では読まない
- secret、token、DB/Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ出さない
- `fly.toml` に CD に必要な非 secret 設定が出ることは許容する。ただし docs 側で topology や攻撃面を重複説明しない

---

## 3. 制約

- スコープが広がる場合は実行前に停止し、人間に確認する
- 規約以上の設計判断が必要な場合は必ず停止し、人間に確認する
- 計画は15タスク以内、多くて20タスク程度に収める
- 説明・報告は必要充分に構造化して行う
- 提案時はおすすめラインまたは次に取り組むべき一つを確定させる
- AIによる確率論的推論とスクリプト/プログラムによる決定論的検証とで、効果的な場面を峻別する。可能な限り決定論的挙動に寄せる

---

## 4. 探索モード、計画検討の基本原則

- 観点を自分で包括的・徹底的に生成し、反芻する
   - 見落としやすい観点を優先する
- 依存関係と優先度を判断し、最重要事項を最大5つに収束させる
  - なぜ重要か、リスク、推奨対応（最大3つ）
- トークン効率のため、最初に対象領域を絞り、`docs/README.md` の読む条件に一致する文書だけ読む

---

## 5. 実装時の基本原則

- 必ず仕様を満たす実装を行う
   - 仕様の不明点、矛盾、穴を解消してから実装する（探索、人間に聞く）
- 場当たり的な対応は避け、可能な限り本質的な実装をする
   - 規約拡張の必要性がある場合は、人間に相談する
- 必要なタイミングでクオリティゲートを通過させる

---

## 6. 完了条件

- 実装が仕様を満たしている
- `docs/post-mortem/lessons.md` を確認し、該当する教訓を検証している
- クオリティゲート（format / lint / typecheck / test　/ 必要に応じてE2E、actionlint）が通る
- 主要な失敗ケースが考慮されている
