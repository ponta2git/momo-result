# テスト・品質規約

## 1. テスト実装対象

MVPでも以下のテストを実装対象に含める。

| 領域 | ツール | 目的 |
|---|---|---|
| web | Vitest + Testing Library | UI部品、フォーム、APIエラー表示 |
| api | MUnit | ユースケース、バリデーション、エラー変換 |
| api integration | MUnit + local PostgreSQL | DB契約、主要クエリ、認証・権限 |
| ocr-worker | pytest | 画像種別判定、解析器、失敗処理 |
| E2E | Playwright | ログイン後の主要フローのsmoke |

## 2. CIチェック項目

CIでは以下を必須チェックにする。

- format
- lint
- typecheck
- unit test
- API integration test
- E2E smoke test
- build

## 3. 品質ツール

| 領域 | ツール |
|---|---|
| web | oxlint + oxfmt |
| api | scalafmt + scalafix |
| ocr-worker | ruff |

実装時は、既存のスクリプトやCI設定がある場合はそれに従う。未整備の場合は、この表に沿って標準コマンドを整備する。
