# momo-result

仲間内で毎週開催している桃鉄1年勝負の結果を記録・集計する Web アプリケーションです。ゲーム画面のスクリーンショットから OCR で下書きを作り、手修正して確定した記録を戦績分析や CSV/TSV 出力に活用します。

## 特長

- **画像から記録**: 結果画面の画像を取り込むと OCR が下書きを作成し、確認・修正してから確定できます。
- **開催単位の管理**: 1回の開催に第1試合・第2試合…と複数の試合を紐づけ、試合ごとにメモも残せます。
- **戦績分析**: 戦績比較、オーナー別比較、プレーヤーレーダー、順位の見通し、振り返り、実績（初達成）などを提供します。
- **CSV/TSV 出力**: 確定済みの記録を表計算ソフトなどで扱える形式で出力できます。
- **Discord 連携**: Discord OAuth でログインし、OCR や分析の完了を Discord へ通知できます。ロール（一般・運用担当・管理者）で操作を出し分けます。
- **summit との共有**: 固定メンバーや開催履歴は summit アプリと同じ DB スキーマ（`momo-db` が所有）を共有します。

## 構成

| ディレクトリ | 役割 | 主な技術 |
| --- | --- | --- |
| `apps/web` | SPA | React / Vite / TypeScript |
| `apps/api` | API・認証・業務 usecase | Scala / http4s / Tapir |
| `apps/processing-worker` | OCR・戦績分析の非同期処理 | Rust |
| `apps/runtime` | 本番 runtime の process 管理 | Go |
| `docs` | 要求・規約・設計文書 | — |

DB は PostgreSQL で、schema と migration は別リポジトリの `momo-db` が管理します。

## 開発

ツールの version は `mise.toml` を参照してください（Node / pnpm / Rust / Go）。API には JDK と sbt が必要です。

```sh
mise install
pnpm install
cp .env.example .env   # 必要な値を設定
pnpm dev               # API + Web を起動
```

- API の build・test の前に `scripts/ci/build-http4s-patch.sh` で固定 http4s fork を準備します（[開発作業規約](docs/dev-rule.md#environment)）。
- DB の起動と migration は `momo-db` checkout の scripts を使います。
- Processing Worker は `pnpm dev` に含まれません。`apps/processing-worker/Dockerfile` から build した container で別に起動します。

主な検証コマンド（一覧は `package.json` の scripts）:

```sh
pnpm web:lint && pnpm web:typecheck && pnpm web:test
pnpm api:test
pnpm analysis:lint && pnpm analysis:test
pnpm e2e               # システム E2E（Docker が必要）
```

詳しい手順や規約は [開発作業規約](docs/dev-rule.md) と [文書索引](docs/README.md) を参照してください。ブランチ運用は `develop` へ PR、`master` は release 専用です。
