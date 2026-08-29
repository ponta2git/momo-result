# AGENTS.md

## 1. 文書マップ

**必要な文書だけを読む。全ドキュメントを事前に一括で読まない。分析済みの内容は再利用し、不要な文書の再読はしない。**
最初に `docs/README.md` を見て、変更対象に必要な文書だけを選ぶ。

`../momo-db` の schema、migration、Drizzle 設定・script、または DB の migration state を変更する場合は、実装や DB 操作より先に `../momo-db/docs/development.md` を最初から最後まで読み、その手順に従う。checkout または文書が存在しない場合や、この repository の規約と矛盾する場合は作業を止めて確認する。

---

## 2. Public / Private 境界

- このリポジトリは public 前提。公開されると攻撃参考になる運用詳細、provider 設定、実測値、kill switch、個別障害詳細は `docs/` に置かない
- `private/` は git 管理外のローカル領域。ユーザーが明示し、作業上必要な場合だけ読む。通常探索・通常実装では読まない
- secret、token、DB/Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ出さない
- `fly.toml` に CD に必要な非 secret 設定が出ることは許容する。ただし docs 側で topology や攻撃面を重複説明しない

---

## 3. 制約

- 事実と推測・提案を峻別して、ごまかさず正直に伝えること
- コード、設定、実行結果から判定できる事実は、検索、parser、compiler、test などの再現可能な手段で確認する。要求の妥当性、利用者価値、trade-off に AI の推論を使う場合は、事実と推測・提案を分ける。
- 決定論的であることだけを、常設する test、checker、quality gate の採用理由にしない。品質証拠の要否と保証範囲は `docs/test-rule.md`、gate への割り当ては `docs/dev-rule.md` に従う。
- 見た目の実確認は、Playwright MCPかcontrol-chromeを使うこと。in-app-browserはつかわない。

---

## 4. 探索モード、計画検討の基本原則

- 依存関係と優先度を判断し、実施順序・説明順序を設定する
  - タスクの目的に照らし合わせて、なぜ・どの程度重要かやリスクを判断すること

---

## 5. 実装時の基本原則

- 仕様の理由、不明点、矛盾、穴を考察・探索し、発見したら作業を止め、人間に質問して解消してから実装する
- タスクの目的に即した**必要充分性や合理性、シンプルさ**をよく吟味して、本質的な実装を行うこと
- 必要なタイミングで必要なクオリティゲートを通過させること
- E2E 検証では Playwright MCP で検証すること

---

## 6. 完了条件

- 実装が仕様を満たしている
- `docs/post-mortem/lessons.md` を確認し、該当する教訓を検証している
- 必要なクオリティゲートが通る
- 主要な失敗ケースが考慮されている
