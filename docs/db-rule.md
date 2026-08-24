# DB利用規約

目的: 共有 PostgreSQL の所有権、consumer contract、migration 順序を判断する。DDL の現在値は `../momo-db`、query の現在値は各 consumer、検証コマンドは `docs/dev-rule.md` を正本とする。

## 1. Ownership

- schema、migration、seed は `../momo-db` が所有する。この repository に migration SQL を複製しない。
- この repository は API / worker の query と、依存する DB 前提の contract test を所有する。
- migration の存在と接続先への適用済み状態は別々に確認する。
- Testcontainers、CI、E2E は `momo-db` の migration を適用した DB を使う。
- row の業務意味と状態遷移は `docs/domain-rule.md`、分析 job / artifact は `docs/requirements/series-analysis-batch.md` を正本とする。

## 2. Durable State Rules

- 認証主体、試合参加者、開催回、試合、下書き、OCR job、分析 job の意味を table 名や nullable だけから推測しない。
- OCR / 分析 job と成果物の状態は DB を正本とし、Redis を配送路に限定する。
- 画像実体、bucket / public URL、credential、OCR raw text 全文を DB 契約にしない。非公開の opaque object key と検証・保持 metadata だけを保存する。
- OCR job の terminal 遷移が下書き表示状態を変える場合は、両方を同じ transaction で更新する。read 時に job 履歴から状態を再構成しない。
- 試合確定、確定済み試合の更新・削除と、対象作品の分析再計算 intent は同じ transaction で確定する。
- outbox writer は transaction 内で外部 I/O を行わず、commit 後にだけ typed effect を返す。dispatch 失敗は業務 transaction を巻き戻さない。
- quota、idempotency、job claim、lease、fence、pointer 切替など競合する判断は、事前 read と write を分けず DB の同じ整合性境界へ閉じる。
- 分析の入力 revision は単調増加値とし、時刻を concurrency token にしない。入力 version、algorithm version、artifact schema version を区別する。
- 分析成果物は作品単位で原子的に公開し、失敗時は直前の成功成果物を維持する。current / previous の確認と chunk read は cleanup と競合しない read 境界で行う。
- terminal job の保持期間と UI の表示件数を別契約として扱い、未完了 job を履歴 cleanup しない。

## 3. Consumer Contract

DB-backed API / worker を変更するときは、次を同じ変更内で満たす。

- 依存する table、column、seed、nullable、default、index、constraint を特定し、新しい前提を contract test に追加する。
- 変更した query / repository を migration 適用済みの実 PostgreSQL で実行する。未実行または skip は DB 挙動を未検証として報告する。
- 複数 table の write は statement / lock 順と、保存後の関連 row を integration test で確認する。
- lease、fence、slot、pointer、cleanup 競合は複数接続で stale owner と rollback を直接通す。
- 大容量 staging は長い control lock から分離し、短い fenced transaction で完全性を再検証してから公開する。
- 分析 publication の lock 順は execution slot、title state、job、request / artifact とし、複数 title state は作品ID順に取得する。試合 mutation と campaign 展開は execution slot を取得しない。
- test が作る row を共通 cleanup の対象へ追加し、並列 test 間で ID、row、stream、file を分離する。
- production が pooler / proxy を使う場合、直接 PostgreSQL への接続成功を wire 互換性の証拠にしない。
- DB row は adapter 境界で失敗可能に decode し、不正値や SQL 例外を domain / application failure へ正規化する。
- dynamic SQL は列挙された fragment から選び、外部入力を SQL text へ連結しない。
- keyset pagination は filter と同じ query に stable tie-breaker を含める。exact count を引き継ぐ場合は snapshot 値であることを契約化する。

集合演算、window / JSON 演算、dynamic fragment、`ON CONFLICT`、lock、guard 付き update、nullable FK、複数 table の filter / order / limit は DB 固有の挙動が強いため、実 PostgreSQL test を必須とする。

## 4. Migration / Deployment

後方互換な変更は migration 適用後に consumer を deploy する。

破壊的変更、NOT NULL / 型変更、大量 backfill、旧 schema 削除は、旧新 consumer の同時稼働期間を考慮して複数段階へ分ける。deploy 順序、rollback、未移行データを実装前に決め、provider 固有の手順は `private/` に置く。
