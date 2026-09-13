# AGENTS.md

## 1. 成果と判断

- 依頼の目的と受入条件に沿って、成果物まで進める。実装の依頼は必要な検証と修正まで、調査・レビュー・計画の依頼はその結果までを扱う。利用者価値と保守負担から、要求を満たすシンプルな方法を選ぶ。
- ユーザーの明示的な指示は、このリポジトリの規約や skill の一般的なガイドラインに優先する。会話で確定した対象・範囲・承認を再利用し、可逆な内部実装や依頼に必要な調査・ローカル検証は判断して進める。
- 利用者の選択が結果を左右し、既存の文脈では決められない場合、または未承認の操作が必要な場合は、その箇所だけ保留する。独立した作業を進め、判断できる具体案と必要な確認を示す。規約や skill が停止理由なら、該当ファイルと文言、適用理由を示し、明文の制約と自分の解釈を区別する。
- 現行の挙動はコード、schema、設定、実行結果で確認する。文書との相違は実行経路・guard・副作用を根拠に解消し、コメント、生成物、test の期待値だけで契約を決めない。要求された新しい挙動は変更後の受入条件とし、事実・未確認事項・提案を区別する。

## 2. 必要な文脈を選ぶ

- 文書の正本や実装入口を選ぶには [docs/README.md](docs/README.md) を使う。対象が分かっていれば該当章へ直接進む。調べる範囲は次の判断に必要な契約と実行経路から広げ、全規約の通読を作業の前提にしない。
- 確認済みの内容は再利用する。関連箇所の変更、新しい矛盾、情報の欠落があれば再確認する。検索一致や要約で条件・例外を判断できない場合は対応する本文を読む。
- [教訓カード](docs/post-mortem/lessons.md) は変更対象に該当するものを設計・検証の判断に反映する。skill も依頼された作業に適用するものを選び、条件付きの参照先は必要になった時に読む。

## 3. 固有の作業境界

- このリポジトリと repository skill は public 前提。攻撃参考になる運用詳細、provider 設定、実測値、kill switch、個別障害詳細を公開文書へ置かない。
- `private/` は git 管理外のローカル領域。ユーザーが明示し、作業上必要な場合だけ読む。通常探索・通常実装では読まない。
- secret、token、DB/Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ出さない。
- CD に必要な非 secret 設定は `fly.toml` と CI 設定に置ける。docs 側で topology や攻撃面を重複説明しない。本番操作の承認境界は [公開運用規約](docs/ops/README.md) に従う。

`../momo-db` の schema、migration、Drizzle 設定・script、または DB の migration state を変更する場合は、実装や DB 操作より先に `../momo-db/docs/development.md` を最初から最後まで読み、その手順に従う。checkout または文書が存在しない場合や、この repository の規約と矛盾する場合は、その DB 変更を止めて確認する。

## 4. 検証と完了

- 品質証拠の要否と保証範囲は [テスト・品質規約](docs/test-rule.md)、必須 gate と検証の終了・再実行は [Change Gates](docs/dev-rule.md#4-change-gates) に従う。変更に必要な gate と主要な失敗条件を確認し、依頼に起因する不具合を修正して受入条件を満たすまで進める。
- E2E 検証は Playwright MCP を使う。見た目の実確認は Playwright MCP または control-chrome を使い、in-app-browser は使わない。
- 完了時は成果、判断に必要な根拠、検証結果と重要な未検証事項を簡潔に報告する。必須の検証が実行できない場合は、理由と残る確認を示し、通過扱いにしない。

## 5. PR / Linear

通常 PR の base は `develop`、`master` 向けは release PR に限る。issue の `Fixes MOM-<番号>`、release に含まれる PR、利用者向け `## Release notes` の記載は [Git 規約](docs/dev-rule.md#8-git) と [.github/pull_request_template.md](.github/pull_request_template.md) に従う。
