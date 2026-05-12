# Postmortem Lessons

このファイルは、過去の障害・検証漏れを実装時に思い出すための入口である。詳細な実装規約・検証規約はここに重複させず、対応する `docs/*-rule.md` や `docs/architecture.md` を正本にする。

## 使い方

1. 変更対象が下の「反芻ポイント」に該当するか確認する。
2. 該当したものだけ、参照先の規約またはポストモーテムを読む。
3. 作業計画・テスト選択・最終報告のいずれかに反映する。
4. 検証できなかった場合は、最終報告で未検証として明記する。

該当しない教訓は無理に適用しない。ただし、なぜ該当しないかを説明できる状態にしておく。

## 棚卸し方針

- 事故固有の経緯・影響・残リスクは個別ポストモーテムに置く。
- 恒久的なルールは `docs/test-rule.md`、`docs/architecture.md`、`docs/db-rule.md`、`docs/dev-rule.md` などに置く。
- このファイルには「いつ思い出すか」「何を問い直すか」「どこを見るか」だけを残す。
- 新しい教訓を追加するときは、まず既存規約へ移せる内容か確認する。

## 反芻ポイント

### DB-backed API / PostgreSQL

該当条件:

- `apps/api` の PostgreSQL repository、Doobie query、DB table/column、migration 前提に触れる。
- API エラーが `relation does not exist`、SQLSTATE、PostgreSQL syntax/runtime error を含む。
- `../momo-db` の schema/migration や共有DBの適用順序に依存する。

問い:

- 接続先DBに必要な migration が適用済みであることを確認したか。
- 変更した repository/query を実PostgreSQLで実行したか。
- DB contract、repository integration、HTTP/usecase test の責務を混同していないか。
- integration test が skip された場合、そのDB動作を未検証として扱っているか。

参照:

- DB共有・migration: `docs/db-rule.md`
- DB-backed API の検証責務: `docs/test-rule.md`
- ローカルDB起動と検証コマンド: `docs/dev-rule.md`
- 元事象: `docs/post-mortem/2026-05-03-backend-matches-list-db-errors.md`

### テストレイヤ選択

該当条件:

- テスト追加・修正を伴う。
- 「どのテストを走らせれば十分か」を判断する。
- ある層のテストで別の層の不具合を代用検証しようとしている。

問い:

- 事故を起こした実行単位を直接通すテストになっているか。
- DB contract、Repository SQL、HTTP境界、Usecase分岐、web component/page の責務を分けているか。
- 近いテストが通ったことを、該当経路の検証として扱っていないか。

参照:

- テストレイヤの責務: `docs/test-rule.md`
- 検証コマンド: `docs/dev-rule.md`

### Frontend / TanStack Query

該当条件:

- `apps/web` で TanStack Query の `queryKey`、`queryFn`、API wrapper、query data の整形を変更する。
- Query の `error`、`isError`、`isFetching`、`enabled`、認証状態を使って UI 表示を分岐する。
- 同じ backend resource を複数画面・複数 feature から読む。

問い:

- `query.error` の存在だけで、現在の致命的な読み込み失敗として表示していないか。
- 認証や `enabled` の前提とエラー表示条件がずれていないか。
- `queryKey` は API リソース名ではなく、runtime cache value の形状まで表しているか。
- cached error、remount、refetch success、別画面で seed された cache shape など、実際の lifecycle をテストしているか。
- mutation 成功後に選択値だけを更新し、候補 list/select を供給する cache を古いままにしていないか。

参照:

- TanStack Query 実装規約: `docs/architecture.md`
- web component/page テスト責務: `docs/test-rule.md`
- 元事象: `docs/post-mortem/2026-05-03-frontend-masters-query-error-visibility.md`
- 元事象: `docs/post-mortem/2026-05-03-frontend-masters-query-key-shape-collision.md`
- 元事象: `docs/post-mortem/2026-05-10-frontend-held-event-create-cache.md`

### Frontend / Form・Filter Interaction

該当条件:

- form、filter、select、input、button の event handler を追加・変更する。
- Zod schema、フォーム値から API request への変換、mutation payload を変更する。
- `setState((current) => ...)` の updater 内で event や DOM node を参照している。
- 障害対応で、報告された UI 操作に近いが同一ではない操作をテストしている。

問い:

- React event 由来の値を handler 内で同期的に退避しているか。
- 変更した入力操作を Testing Library + user-event で直接実行したか。
- route param、prefill、hidden state 由来の workflow identifier が schema parse / transform 後の
  request body に残ることを検証したか。
- create / confirm / update で受け付ける field の違いを、共有変換の偶然ではなくテストで固定したか。
- optional field の有無が API/usecase の mode や副作用を変える場合、その field の仕様上の役割を
  domain/API docs で確認したか。
- mutation で追加した候補を選ぶ UI では、成功通知だけでなく option/list への追加と選択状態を検証したか。
- 障害対応では、報告された操作そのものを通したか。
- 同一 component 内に同種の handler / state updater pattern が残っていないか。

参照:

- web component/page の入力操作テスト責務: `docs/test-rule.md`
- 元事象: `docs/post-mortem/2026-05-03-frontend-matches-filter-event-currenttarget.md`
- 再発事象: `docs/post-mortem/2026-05-04-frontend-matches-sort-event-currenttarget-regression.md`
- 元事象: `docs/post-mortem/2026-05-10-frontend-ocr-confirm-match-draft-id-dropped.md`

### Frontend / Test Double・Test Oracle

該当条件:

- フロントの `*.test.ts(x)`、MSW handler、test factory、test double、DOM API mock を追加・変更する。
- `vi.spyOn`、プロトタイプ差し替え、module-scope 可変 store、`waitFor`、`setTimeout` を使う。
- assertion が「存在する」「crash しない」程度に留まっている。

問い:

- test oracle は role/name/value/state など、壊れ方を捕まえられる具体性を持っているか。
- module-scope store、mock、storage、timer の後片付けは共通 setup に集約されているか。
- MSW の in-flight 状態や非同期待ちは、実時間 delay ではなく決定論的に制御しているか。
- `as unknown as` や inline payload 量産で、型契約や fixture 管理を回避していないか。

参照:

- フロントテスト基盤: `docs/test-rule.md`
- フロント実装規約: `docs/architecture.md`
- 共有 factory: `apps/web/src/test/factories/`
- MSW reset: `apps/web/src/test/msw/handlers.ts` の `resetMswStores`

### React 新APIの採否判断

該当条件:

- React 19 系の新API、Suspense、`use(promise)`、`useActionState`、`useFormStatus`、`<Activity>` などの採用を検討する。
- 既存の TanStack Query、フォーム、ルーティング、状態管理を置き換える可能性がある。

問い:

- 新APIがあるから使うのではなく、既存経路より複雑さや不具合面を減らす目的が明確か。
- TanStack Query が担っている cache、dedup、retry、認証・エラー正規化を失わないか。
- optimistic 更新や form pending は、API の制約に合った位置で扱っているか。
- 採用しない結論も、根拠を短く残したか。

参照:

- React/TanStack Query 実装規約: `docs/architecture.md`
- web component/page テスト責務: `docs/test-rule.md`

## 最終報告に含めること

該当する教訓があった場合、最終報告では次を短く述べる。

- どの教訓が該当したか。
- どの規約文書に従ったか。
- どのテスト・コマンドで検証したか。
- DB/integration test が skip された場合、何が未検証か。
- 追加すべきテストや品質ゲートが残る場合、その残リスク。
