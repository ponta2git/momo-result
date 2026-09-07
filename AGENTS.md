# AGENTS.md

## 1. 文書マップ

最初に `docs/README.md` で変更対象を選び、次の判断に必要な章と実装を読む。複数スコープに共通する参照は一度扱う。
確認済みの内容は再利用する。関連箇所の変更、新しい矛盾、判断に必要な情報の欠落がある場合に、その箇所を再確認する。

`../momo-db` の schema、migration、Drizzle 設定・script、または DB の migration state を変更する場合は、実装や DB 操作より先に `../momo-db/docs/development.md` を最初から最後まで読み、その手順に従う。checkout または文書が存在しない場合や、この repository の規約と矛盾する場合は作業を止めて確認する。

---

## 2. Public / Private 境界

- このリポジトリは public 前提。公開されると攻撃参考になる運用詳細、provider 設定、実測値、kill switch、個別障害詳細は `docs/` に置かない
- `private/` は git 管理外のローカル領域。ユーザーが明示し、作業上必要な場合だけ読む。通常探索・通常実装では読まない
- secret、token、DB/Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ出さない
- `fly.toml` に CD に必要な非 secret 設定が出ることは許容する。ただし docs 側で topology や攻撃面を重複説明しない

---

## 3. 制約

- 現行の挙動・制約は、コード、schema、設定、実行結果から確認する。文書と矛盾する場合は、確認できた実行経路・guard・副作用を優先し、文書改訂の根拠にする。コメント、生成物、test の期待値だけで実行契約を決めない。ユーザーが求めた新しい挙動は、変更後の受入条件として扱う。
- 事実、未確認事項、提案を区別する。要求の妥当性や trade-off は利用者価値から判断し、コードから確認できる事実と混同しない。
- 決定論的であることだけを、常設する test、checker、quality gate の採用理由にしない。品質証拠の要否と保証範囲は `docs/test-rule.md`、gate への割り当ては `docs/dev-rule.md` に従う。
- 見た目の実確認は、Playwright MCPかcontrol-chromeを使うこと。in-app-browserはつかわない。

---

## 4. 探索・計画

- 依存関係と利用者影響に従い、次の判断に必要な不明点から調べる。根拠が揃ったらその判断を実行し、具体的な不足が生じた範囲へ探索を広げる。
- 長い取得結果は関連する章・symbol・周辺条件に絞る。要約や検索一致だけでは分岐を判断できない場合に、対応する本文を読む。

---

## 5. 実装時の基本原則

- 依頼された成果物まで作業を進める。調査・レビュー・計画の依頼では、その結果を成果物とする。
- コードと既存の指示で決まる事項、および承認された範囲内の可逆な内部実装は判断して進める。
- 利用者の選択が必要な未決事項、または未承認の操作が残る場合は、その箇所を保留して根拠と選択肢を示す。独立して進められる作業は継続し、既に得た承認は同じ対象・範囲で再利用する。
- 必要充分性、利用者価値、保守負担を比較し、要求を満たすシンプルな実装を選ぶ。
- 必要なタイミングで必要なクオリティゲートを通過させること
- E2E 検証では Playwright MCP で検証すること

---

## 6. 完了条件

- 依頼された成果物が受入条件を満たしている。
- `docs/post-mortem/lessons.md` の該当する教訓を、必要な実装・検証へ反映している。
- 必要な gate が通り、主要な失敗ケースについて `docs/test-rule.md` に従う証拠を確認している。検証の終了・再実行は `docs/dev-rule.md` の Change Gates に従う。
- 結果、判断に必要な根拠、重要な未検証事項を報告している。

---

## 7. PR / Linear

- 通常PRは`develop`をbaseにする。release以外のPRを`master`へ向けない
- Linear issueを完了させる変更はPR本文に`Fixes MOM-<番号>`を記載し、commit messageのmagic wordへ依存しない
- `master`向けrelease PRには、含まれるPRと対象の`Fixes MOM-<番号>`をもう一度列挙し、利用者向け`## Release notes`を記載する
- release PR本文や公開release noteへsecret、private operations detail、攻撃参考になる情報を含めない
