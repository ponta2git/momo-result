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

## 2. テストレイヤの責務

テストは層ごとの責務を分ける。ある層のテストで別の層の不具合を代用検証しない。

| 層 | 責務 | 代表例 |
|---|---|---|
| DB contract | APIが前提にする table / column / seed / nullable / default を確認する | `DbContractSpec` |
| PostgreSQL repository | SQLが実DBで動くこと、filter / order / transaction を確認する | `Postgres*RepositorySpec` |
| HTTP spec | request parameter、auth/CSRF、response encoding、AppError mapping を確認する | `*HttpSpec` |
| Usecase / in-memory | DBなしでdomain分岐、validation、status parsing を確認する | `*UseCaseSpec` |
| web component/page | UI表示、フォーム操作、APIエラー表示を確認する | Vitest + Testing Library |
| E2E smoke | 主要フローが結合状態で破綻しないことを確認する | Playwright |

### web component/page の追加確認

TanStack Queryを使うページでAPIエラー表示を追加・変更する場合は、表示したい失敗状態を明示する。

- ページ単位の読み込み失敗表示は、`query.error` や `isError` の有無だけを根拠にしない。
- 認証後に有効化されるqueryは、エラー表示側も認証・`enabled` 前提とずれないようにする。
- キャッシュ済みエラー、remount、refetch中、refetch成功後のうち、変更対象に該当する状態を
  Vitest + Testing Library + MSWで検証する。
- 再取得中は過去エラーを隠す仕様なら、cached error -> remount -> delayed success のように、
  失敗した実行経路を通るテストを追加する。
- 同じbackend resourceを複数画面で読むqueryを追加・変更する場合は、Query Keyが保存データ形状を共有してよいか確認する。
  生APIレスポンスとfeature-localに整形した配列・ViewModelが混在し得る場合は、衝突するcache shapeをseedするか、
  実際の画面遷移順を通すテストを追加する。

フォーム・フィルタ・select/input の状態更新を追加・変更する場合は、少なくとも変更した代表操作を
Testing Library の user-event で実行する。

- `onChange` / `onSubmit` / `onClick` の実行経路は、レンダリング確認だけで代用しない。
- React event の値を state updater 内で読む実装を避け、必要な値は handler 内で先に退避する。
- form/filter の障害対応では、類似する代表操作ではなく、報告された操作そのものを user-event で通す。
- event lifetime の障害を直す場合は、同一 component 内の同種 `event` / state updater pattern を検索して確認する。
- PC用とモバイル用で同じ入力UIを二重に持つ場合は、どちらの実行経路を検証したかを明確にする。

## 3. DB-backed APIの必須検証

DB-backed API を変更するときは、該当Endpointに対応するPostgreSQL repository pathを実DBで実行する。

原則:

- Scala/DoobieでコンパイルできたSQLは、PostgreSQLで正しいSQLとは限らない。
- 関連Repositoryのテスト成功は、該当EndpointのDB経路を検証したことにならない。
- integration test がDB未起動でskipされた場合、DB動作は未検証として扱う。

必須確認:

- endpoint / usecase / repository / method を特定する。
- 新しいDB table / column / seedを前提にする場合、`DbContractSpec` を追加・更新する。
- 変更したRepository methodを実PostgreSQLで実行する `Postgres*RepositorySpec` を追加・更新する。
- 新しいDB tableに書き込むintegration testを追加したら、cleanup対象も更新する。

実DBテストが必須のSQL:

- `UNION`
- `INTERSECT`
- `EXCEPT`
- `DISTINCT`
- window function
- JSON operator
- dynamic fragment
- 複数tableをまたぐfilter/order/limit

## 4. CIチェック項目

CIでは以下を必須チェックにする。

- format
- lint
- typecheck
- unit test
- API integration test
- E2E smoke test
- build

## 5. 品質ツール

| 領域 | ツール |
|---|---|
| web | oxlint + oxfmt |
| api | scalafmt + scalafix |
| ocr-worker | ruff |

実装時は、既存のスクリプトやCI設定がある場合はそれに従う。未整備の場合は、この表に沿って標準コマンドを整備する。
