# アーキテクチャ規約

目的: Web、API、Processing Worker、共有 DB、public runtime の責務と依存方向、資源の境界、script / tool の配置を判断する。現在の型、設定、コマンドは実装、wire payload の shape / limit は対応する endpoint または schema を正本とし、本書ではその正本を参照する。

subsystem 内の実装契約は [API 規約](api-rule.md)、[Web 実装規約](web-rule.md)、[Worker 規約](worker-rule.md) が持つ。業務意味は [ドメイン規約](domain-rule.md)、DB は [DB 規約](db-rule.md)、OCR job は [OCR job 契約](ocr-job-contract.md)、戦績分析の横断要求は [分析 batch 要求](requirements/series-analysis-batch.md)、表示と操作は [UI 規約](ui-rule.md)、非機能要求は [システム要求](requirements/system-design.md) を参照する。複数文書にまたがる契約の分担は [文書索引](README.md#正本の役割) にある。

## System Boundaries

| 境界 | 責務 | 正本 |
| --- | --- | --- |
| Web | SPA、入力、表示、画面状態 | `apps/web/src/` |
| API | HTTP、認証、usecase、DB adapter | Tapir endpoint、`apps/api/` |
| Processing Worker | OCR / 分析の非同期実行、lease、外部 I/O | `apps/processing-worker/` |
| DB | 業務状態、session、OAuth state 使用済み記録、job、入力、成果物 | 対象 `momo-db` checkout の migration（[DB 規約](db-rule.md#ownership)） |
| public HTTP runtime | Web 配信、API、reverse proxy | `Dockerfile`、`deploy/`、runtime tool |

- OCR / 分析処理は public HTTP runtime から分離した Processing Worker で実行し、高負荷分析は HTTP request の外で行う。高負荷処理が利用者向け HTTP の可用性を巻き込まないためである。
- DB を業務状態と永続 job の正本とし、Worker が既存 job を直接取得する。job の受け渡しは DB だけで行い、wake が欠けても DB から回復できるようにする。

## Dependency Directions

依存方向は責務分離によってアーキテクチャの統率を保つための意図的な選択である。コード削減や簡素化はこの境界を保ったまま行い、層は必要な箇所に限って足す。

| subsystem | 依存方向 | 詳細 |
| --- | --- | --- |
| API | `http → auth / usecases → domain + ports / repositories`、`adapters → domain + ports / repositories`。`bootstrap` だけが実装を選ぶ | [API 規約](api-rule.md#bootstrap--http-execution) |
| Web | `app → features → shared` と、shared 内の基盤・業務別 module の分担 | [Web 実装規約の Layering](web-rule.md#layering)。import の可否は `apps/web/oxlint.config.ts` が検査する |
| Processing Worker | `runtime → capability crate`、`worker → momo-notifications` のいずれも一方向 | [Worker 規約](worker-rule.md#process-boundary) |
| 共有 DB | 業務ルール・再試行方針・集計状態の更新手順はアプリ、FK・一意性・改変不能性・原子的な条件付き更新は DB | [DB 規約](db-rule.md#durable-state-rules) |

## Storage / Resource Boundaries

- rate limit のカウンタは API process 内で保持し、scope ごとの key 数と有効期間を制限する。process 間では共有せず再起動で初期化されるため、永続する quota や同時 job 上限は DB の原子的な操作で別に守る。
- 接続 pool は runtime で再利用し、取得待ちの実行枠も pool 上限へ合わせる。利用しない接続の常時補充や keepalive query を避け、idle な pool が検証用の traffic を出し続けないようにする一方、request ごとの接続開閉へ置き換えない。SQL 側の上限は transaction pooler 下でも保つため各 transaction で適用する（[API 規約の Usecase / Repository](api-rule.md#usecase--repository)）。
- 受付判定は、必要な外部状態を受付時に取得した結果から行い、quota と fail-closed の意味を保つ。直前の PING や cache した外部状態は成功保証に使わない。
- 処理中の lease heartbeat、待機中の capability 更新、job の起床通知、実行可能時刻、履歴保持は別の目的を持つ。閾値は相互の期限・shutdown 予算・利用者の待ち時間と合わせて調整し、コマンド数や query 負荷はその判断材料の一つとして扱う。
- query や index の測定には開発用 data store と分離した合成 fixture を使い、実験資源を破棄する。採否は整合性と resource 上限を守ったうえで単純さと保守負担も含めて決める。provider の稼働時間や請求額への効果を判断する場合は、それを示す証拠を使い、接続数・コマンド数の削減と区別する。

## Scripts / Tooling Boundaries

- `apps/web/scripts` は API / Web のローカル起動、Web の生成・build 検査・隔離 E2E 起動を所有する Node の開発用境界であり、`src` の実行層ではない。この開発用境界から production へ渡すのは生成された型・validator に限り、script や E2E fixture は import しない。
- 複数 service の E2E 環境管理と runtime HTTP smoke は root の `scripts/e2e` に置く。
- `apps/web/scripts/e2e` の入口は各 run の資源と後片付けを所有し、共通 runtime は隔離した子 process 環境と service の起動を所有する。子 process の起動・中断・終了待ちはローカル開発と同じ共通 module を使い、開発用 env の読取りはローカル起動 tool に閉じる。入口は実行専用とし、ライブラリとして import しない。OCR 専用の制御 worker・通知 recorder・画像 fixture は必要な suite に個別に用意し、通常 E2E はそれらなしで実行できるようにする。
- `scripts/ci` の Shell は外部 command、環境変数、file の受け渡し、終了状態と実行順序を扱い、アプリの業務判断は各 subsystem に置く。workflow は gate の依存関係、権限、service、artifact の受け渡しを所有する。
- 構造化された CI data の集計・秘匿化・来歴検証と metadata 生成は `scripts/tools/cmd/ci-tool` に集約する。producer と consumer は同じ検証規則を使い、後続 release が以前の metadata を読める契約を保つ。CLI の入力・出力・終了値は [command の説明](../scripts/tools/cmd/ci-tool/README.md) から辿れる。
- 独立した診断・評価用 Go command も `scripts/tools/cmd`、本番 runtime の process 管理と probe は独立 module の `apps/runtime` に置く。CI 専用の集計・判定は runtime binary の外に置く。

## Runtime / Security

- secret、session / CSRF token、接続 URL、画像内容、OCR raw text、分析成果物本文、DB 例外本文や bind 値をログへ出さない。診断には job / attempt の安全な識別子、状態、待機時間、失敗理由、処理段階、時間予算、SQLSTATE などの分類値を使う。
- upload は許可形式、byte 数、寸法、内容 fingerprint を完全 decode 前後の境界で検証する。
- 画像 object は作成後 immutable とし、再送は保存済みの内容と照合する。local と object storage で読取上限と整合性検証を共有し、読取は検証済みの descriptor が指す object に限る。
- stream response は handler 完了ではなく転送終了時に success / error / cancel と byte 数を exactly once 観測する。
