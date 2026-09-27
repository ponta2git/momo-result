# AGENTS.md

## 1. 成果と判断

- 実装依頼は必要な修正と検証まで進め、受入条件を満たす。調査・レビュー・計画は依頼された結果を成果物とし、実装も依頼の範囲に含まれる場合は変更へ進む。利用者価値と保守負担から、要求を満たすシンプルな方法を選ぶ。
- ユーザーの明示的な指示を、このリポジトリの規約や skill の一般的なガイドラインより優先する。会話で確定した対象・範囲・承認を引き継ぎ、依頼に必要な調査、可逆な編集、隔離されたローカル検証は判断して進める。
- 結果を左右し、既存の文脈では決められない事項や未承認の操作がある場合は、その箇所だけ保留する。独立した作業を済ませ、確認時には対象・差分・影響・検証結果など判断に必要な具体案を示す。規約や skill が停止理由なら、該当ファイルへのリンクと原文を示し、明文の制約と自分の解釈を区別する。

## 2. 必要な文脈を選ぶ

- 正本や実装入口が不明なら [docs/README.md](docs/README.md) を使い、分かっていれば該当章へ直接進む。次の判断に必要な契約と実行経路を調べ、全規約の通読を前提にしない。確認済みの内容は、関連する変更・矛盾・欠落が生じるまで再利用する。
- 現行の挙動はコード、schema、設定、実行結果で確認する。文書との相違は実行経路・guard・副作用から解消し、test の期待値や生成物だけで契約を決めない。要求された新しい挙動は変更後の受入条件として扱う。
- [教訓カード](docs/post-mortem/lessons.md) と skill は対象に該当するものを使う。参照先は判断に必要な章だけ読み、検索結果や要約で条件・例外を判断できない場合に本文へ進む。

## 3. 固有の作業境界

- このリポジトリと repository skill は public 前提。攻撃参考になる運用詳細、provider 設定、実測値、kill switch、個別障害詳細を公開文書へ置かない。
- `private/` は git 管理外のローカル領域。ユーザーが参照を明示した範囲を、作業上必要な場合だけ読む。指定された private ファイルの分析依頼は、そのファイルの参照許可として扱う。通常探索や無関係な private 記録へ読み広げない。
- secret、token、DB/Redis URL、origin lock token、OAuth secret、session / CSRF token を docs、PR、Issue、チャット、ログへ出さない。
- CD に必要な非 secret 設定は `fly.toml` と CI 設定に置ける。docs 側で topology や攻撃面を重複説明しない。本番操作の承認境界は [公開運用規約](docs/ops/README.md) に従う。

`../momo-db` の schema、migration、Drizzle 設定・script、または DB の migration state を変更する場合は、実装や DB 操作より先に `../momo-db/docs/development.md` を最初から最後まで読み、その手順に従う。checkout または文書が存在しない場合や、この repository の規約と矛盾する場合は、その DB 変更を止めて確認する。

## 4. 検証と完了

- 品質証拠は [テスト・品質規約](docs/test-rule.md) から選び、変更に該当する [必須 gate](docs/dev-rule.md#4-change-gates) を通す。必要な検証を通したら完了へ進む。追加・再実行は結果を無効にする変更、失敗、具体的な未解決事項がある範囲に限る。
- E2E 検証は Playwright MCP を使う。見た目の実確認は Playwright MCP または control-chrome を使い、in-app-browser は使わない。
- 報告は成果を先に、根拠・検証結果・重要な未検証事項を平易に短く伝える。事実、未確認事項、提案を区別し、必須検証を実行できなかった場合は理由と残る確認を示す。未実行を通過扱いにしない。

## 5. PR / Linear

通常 PR の base は `develop`、`master` 向けは release PR に限る。issue の `Fixes MOM-<番号>`、release に含まれる PR、利用者向け `## Release notes` の記載は [Git 規約](docs/dev-rule.md#8-git) と [.github/pull_request_template.md](.github/pull_request_template.md) に従う。
