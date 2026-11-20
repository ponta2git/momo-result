# 文書索引

機能の挙動と受入条件は `requirements/`、サービス間・実装層の契約は `implementation/`、開発・検証・リリースの手順は `development/` にある。依頼の進め方、参照権限、完了の判断は [AGENTS.md](../AGENTS.md) に従う。

## 変更対象から読む

### 機能と要求

| 知りたいこと | 最初に読む文書 |
| --- | --- |
| 誰が何を操作できるか。試合の入力・確定・出力には何が必要か | [基本要求](requirements/base.md) が認証・権限、OCR 取り込み、CSV / TSV の仕様を持つ。用語、状態遷移、固定メンバーの意味は [ドメイン規約](domain-rule.md) にある。 |
| 開催を探し、次の試合を記録する | [開催一覧・詳細](requirements/held-event-detail.md) が画面と記録の導線、[試合メモ](requirements/match-note.md) が本文、編集競合、各一覧での表示を定める。 |
| 戦績を比べ、直近の結果を振り返る | [戦績比較](requirements/series-comparison.md) が共通の対象範囲と指標を定める。[見込み順位との差](requirements/series-expected-rank-gap.md)、[オーナー別比較](requirements/series-owner-comparison.md)、[順位の見通し](requirements/series-rank-outlook.md)、[振り返りと行動仮説](requirements/series-review-playbook.md) はそれぞれの計算と表示を扱う。 |
| プレーヤー別の強みや実績を読む | 成績6軸の採点は [プレーヤーレーダー](requirements/series-player-radar.md)、実績リスト・初達成・7軸目の配点は [実績達成管理](requirements/player-achievements.md) にある。 |
| 分析結果を計算・公開・更新する | [分析バッチ](requirements/series-analysis-batch.md) がジョブ、成果物、再計算、互換性を定める。 |
| 可用性・性能・縮退時の挙動を判断する | [システム要求](requirements/system-design.md) が達成条件、[アーキテクチャ](architecture.md) がサービスの責務・依存方向・資源境界を定める。 |

**検討中の要求**　[勝ち筋マップの草案](requirements/series-win-path.md#10-未決事項) は採否と範囲が未確定。現行の指標には [戦績比較](requirements/series-comparison.md) を使う。

### 実装・検証・運用

| 変更対象 | 判断の正本と実装の入口 |
| --- | --- |
| 画面・文言・Web | 画面をまたぐ導線、操作、表現、視覚レビューは [UI 規約](ui-rule.md)。コンポーネント、取得状態、フォーム、モーションの実装は [Web 実装規約](implementation/web.md) から `apps/web/src/` へ進む。 |
| API・永続化 | [API 規約](implementation/api.md) は Tapir の HTTP 契約、認証、usecase と transaction を扱う。保存・排他・移行は [DB 規約](implementation/database.md)。共有 DB 側を変更するときは [変更前の手順](../AGENTS.md#作業境界) を使う。 |
| OCR・非同期処理 | 受付から再試行までの API と Worker の約束は [OCR ジョブ契約](implementation/ocr-job.md)。実行プロセス、資源の割当、分析結果の公開は [Worker 規約](implementation/worker.md) から `apps/processing-worker/` へ進む。 |
| テスト・CI | [テスト・品質規約](development/test-policy.md) で何を確認するかを選び、[変更別の必須 gate](development/workflow.md#change-gates) で実行単位を確かめる。suite の境界・隔離・並列性・coverage・CI artifact を変える場合は [テスト実行設計](development/test-architecture.md) を読む。 |
| 起動・コマンド・Git | [開発作業規約](development/workflow.md) がローカル環境、E2E、Git の入口。現在のコマンドとオプションは package manifest・build 設定・script にある。 |
| リリース・復旧 | CI の変更分類、候補の来歴、配備・復旧検証は [CI・リリース規約](development/release.md)。共有 DB と consumer の切替順は [DB 規約の Migration / Deployment](implementation/database.md#migration--deployment)、本番操作の承認は [公開運用規約](ops/README.md) に従う。 |
| 教訓・インシデント | 通常の変更では該当する [教訓カード](post-mortem/lessons.md) を引く。インシデントの分析・レビュー・対策の再評価は [公開方針](post-mortem/README.md) と [postmortem skill](../.agents/skills/postmortem/SKILL.md) を使う。 |

ツールの入力と結果は各ツールの文書で確認する。

- データ投入は [実績の初期投入](tools/initial-achievement-import.md)。
- OCR の校正と標本の評価は [Rust OCR evaluator](../scripts/tools/cmd/ocr-rust-evaluator/README.md) と [OCR evaluation audit](../scripts/tools/cmd/ocr-evaluation-audit/README.md)。
- 資源の診断は [cgroup memory probe](../scripts/tools/cmd/cgroup-memory-probe/README.md) と [Linux memory snapshot](../scripts/tools/linux-memory-snapshot.md)。CI データの集計と来歴検証は [CI tool](../scripts/tools/cmd/ci-tool/README.md)。

## 正本の役割

複数の領域にまたがる変更は、変更する判断を持つ節から読む。

| 契約 | 分担 |
| --- | --- |
| 認証・認可 | [ロール別の操作権限](requirements/base.md#33-操作権限) を起点に、[試合メモの編集](requirements/match-note.md#4-authorization--provenance--concurrency)、[分析管理](requirements/series-analysis-batch.md#6-api--web--admin)、[レーダー基準の管理](requirements/series-player-radar.md#運用担当管理者の操作) の条件を引く。リクエストの認証と拒否は [API](implementation/api.md#error--auth)、画面の権限状態は [Web](implementation/web.md#server-state) が扱う。 |
| Discord 通知 | [設定と通知対象](requirements/base.md#34-discord通知設定)・[分析完了通知](requirements/series-analysis-batch.md#分析完了通知) が利用者への挙動を定める。[API](implementation/api.md#transaction--job-wake) が設定操作、[DB](implementation/database.md#notifications) が保存・取消の順序、[Worker](implementation/worker.md#notifications) が送信を担う。共有 wire と consumer 間の排他は対象の `momo-db` にある `docs/discord-notifications.md` に従う。 |
| 旧 ID と現行 ID | [DB 規約](implementation/database.md#identifiers-and-decoding) が保存形式と schema 検査、[API 規約](implementation/api.md#bootstrap--http-execution) が起動時の判定、[テスト実行設計](development/test-architecture.md#api--worker-の実行境界) が互換性の検証範囲を扱う。 |
| 分析成果物と公開世代の切替 | [分析要求](requirements/series-analysis-batch.md#8-compatibility--release--rollback) が互換性と切戻しの条件を定める。[DB](implementation/database.md#locks-and-transactions) が排他と不変性、[Worker](implementation/worker.md#analysis-publication-and-release-control) が検証と公開、[API](implementation/api.md#wire-boundary) が読み出す範囲、[リリース規約](development/release.md#analysis-promotion-and-backfill) が配備後の昇格判定を扱う。 |
| 固定4人の順序と表示 | 色の意味と並びは [UI 規約の色・面・境界](ui-rule.md#色面境界) と [4人の共通結果台帳](ui-rule.md#4人の共通結果台帳)、共通の定義と表示部品は [Web の実装入口](implementation/web.md#implementation-entry-points) にある。 |

## 正本と証拠

- [版付き JSON Schema](schemas/) は OCR 入力と分析成果物の構造・上限を定める。分析の公開世代と検証契約の対応は [Rust から生成する publication contract](schemas/series-analysis-publication-contract-v2.json) にある。保存済みの旧版と現行 reader の対応範囲は [分析の互換性要件](requirements/series-analysis-batch.md#8-compatibility--release--rollback) で区別する。
- [共有 fixture](schemas/fixtures/) は複数の実装を同じ例で検証するために使う。具体例を正本とするのは専門規約が明示した場合に限る。テスト・snapshot・report が示す範囲は [品質証拠の扱い](development/test-policy.md#証拠モデルと正本) に従う。
- 型・値・挙動はコードと設定で確認する。HTTP 契約は Tapir が所有し、OpenAPI と Web 型はそこから生成する。文書には設計上の意図、機械検査が届かない意味、実装への入口を残す。コマンド・lint の規則一覧・現在値は実行側に置く。

## 文書の増減と保守

- 条件と例外は判断を所有する文書にまとめ、他からは該当節へリンクする。独立した読者や作業があり、参照の負担を減らせる場合に分割する。ツール固有の手順は実装に隣接させ、隣接する README がない場合は `docs/tools/` に置く。
- 移行中の契約には撤去条件を書く。本番データと全 consumer の切替を確認してから手順を撤去し、移行後も必要な検査・不変条件を残す。[DB の移行中の契約](implementation/database.md#transitional-contracts)
- 公開範囲と非公開資料の参照条件は [作業指針](../AGENTS.md#作業境界) に従う。継続判断に必要な計画・調査履歴や個別の障害記録は `private/` で扱う。教訓を加える前に既存の実装・規約で不足する点と維持負担を確かめる。同じ教訓はまとめ、単発の手順は該当する変更に限る。公開するカードには思い出す条件と確認事項を、担当規約には恒久的な対策を置く。
- AGENTS は横断する判断と権限境界、専門規約は対象の契約、skill は作業の適用条件・成果物・参照先を持つ。全文確認や固定順序は権限・データ保全・互換性などの根拠がある箇所に限る。並列化の原則は [作業指針](../AGENTS.md#判断と並列作業) に置き、モデルや推論設定、委任数は実行環境で選ぶ。
- skill の説明で該当する依頼を識別できるようにし、参照資料やテンプレート項目は依頼に合わせて選ぶ。規約や skill の改訂時は、参照・承認・成果物・完了の判断への影響を確認する。懸念のある依頼に絞って試し、文面や試行件数の確認と実際のエージェントの挙動を区別する。[AGENTS と skills の見直し指針](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)・[モデル別ガイド](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)
