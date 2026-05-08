# OCR accuracy evaluator

`eval_accuracy.py` は、ローカルの OCR サンプル画像を `answers.tsv` と照合し、フィールド単位の正答率と処理時間を集計する分析用スクリプトです。

実装本体は同じディレクトリの `eval_lib/` にあります。`eval_accuracy.py` は、リポジトリ内の import path を通して `eval_lib.cli.main()` を呼び出す薄いエントリポイントです。

## 前提

- 実行場所はリポジトリルートです。
- `apps/ocr-worker` の依存関係を `uv sync --project apps/ocr-worker` で同期済みにします。
- `.env` が必要な環境では、実行前に `set -a; source .env; set +a` で読み込みます。
- 実画像サンプルは git 管理外の `ocr_samples/` 配下に置きます。
- サンプル画像は `.jpg` / `.jpeg` / `.png` / `.webp` のみ対象です。

## 入力ファイル

### サンプル画像

`--samples-dir` に、評価対象画像を直接含むディレクトリを指定します。サブディレクトリは走査しません。

ファイル名は次の形式にします。

```text
{game}_{matchNo}_{yyyymmdd}_{map}_{slotPrefix}{slotName}[_{comment}].{ext}
```

例:

```text
桃鉄2_007_20251121_西日本_01総資産_メモ.jpg
桃鉄2_007_20251121_西日本_02収益額.png
桃鉄2_007_20251121_西日本_03事件簿.webp
```

`slotPrefix` は OCR 画面種別に対応します。

| prefix | 画面種別 | 比較フィールド |
|---|---|---|
| `01` | `total_assets` | `順位`, `総資産` |
| `02` | `revenue` | `収益` |
| `03` | `incident_log` | `目的地`, `プラス駅`, `マイナス駅`, `カード駅`, `カード売り場`, `スリの銀次` |

命名規約に合わないファイル、または `01` / `02` / `03` 以外の prefix は無視されます。

### answers.tsv

`--answers` に正解 TSV を指定します。少なくとも次の列が必要です。

```text
対戦No.	プレー順	プレーヤー名	順位	総資産	収益	目的地	プラス駅	マイナス駅	カード駅	カード売り場	スリの銀次
```

1 対戦につき 4 プレイヤー行を想定します。4 行でない場合は警告を出しますが、評価自体は継続します。

空欄の数値フィールドは `None` または `0` として扱われます。事件簿列は空欄が `0` になります。

## 基本コマンド

デバッグ成果物を出しながら正答率を確認します。

```sh
set -a; source .env; set +a
MOMO_OCR_DEBUG_DIR=/tmp/momo-ocr-debug \
uv run --project apps/ocr-worker python apps/ocr-worker/scripts/eval_accuracy.py \
  --samples-dir ocr_samples/003_桃鉄2 \
  --answers ocr_samples/003_桃鉄2/answers.tsv \
  --report apps/ocr-worker/out/eval-momo2.json \
  --mode debug
```

処理時間だけを測る場合は `timing` モードを使います。`timing` モードでは debug directory は使われません。

```sh
set -a; source .env; set +a
uv run --project apps/ocr-worker python apps/ocr-worker/scripts/eval_accuracy.py \
  --samples-dir ocr_samples/003_桃鉄2 \
  --answers ocr_samples/003_桃鉄2/answers.tsv \
  --mode timing \
  --repeat 3 \
  --report apps/ocr-worker/out/eval-momo2-timing.json
```

## よく使うオプション

| オプション | 用途 |
|---|---|
| `--mode debug` | デバッグ成果物を出す通常分析。デフォルトです。 |
| `--mode timing` | デバッグ成果物なしで処理時間を測ります。 |
| `--repeat N` | `timing` モードで、1 画像あたりの OCR 実行回数を指定します。`debug` モードでは常に 1 回です。 |
| `--debug-dir DIR` | `MOMO_OCR_DEBUG_DIR` の代わりに debug 出力先を指定します。各画像の stem ごとにサブディレクトリが作られます。 |
| `--match N` | 対戦 No. で絞り込みます。複数回指定できます。 |
| `--screen-types 01` | 画面 prefix で絞り込みます。`01` / `02` / `03` を複数回指定できます。 |
| `--limit N` | ソート後の先頭 N 件だけ実行します。 |
| `--summary-only` | stderr の画像ごとの進捗表示を抑え、stdout の summary と `--report` の詳細だけ出します。 |

例:

```sh
uv run --project apps/ocr-worker python apps/ocr-worker/scripts/eval_accuracy.py \
  --samples-dir ocr_samples/003_桃鉄2 \
  --answers ocr_samples/003_桃鉄2/answers.tsv \
  --match 7 \
  --match 8 \
  --screen-types 01 \
  --screen-types 03 \
  --limit 10 \
  --report apps/ocr-worker/out/eval-filtered.json
```

## 出力

stdout には集計 summary が JSON で出ます。

`--report` を指定すると、summary と画像ごとの詳細を含む JSON ファイルを書き出します。

主な項目:

| 項目 | 内容 |
|---|---|
| `summary.images` | 評価対象画像数 |
| `summary.fields_total` | 比較対象フィールド数 |
| `summary.fields_correct` | 正答フィールド数 |
| `summary.accuracy` | 全体正答率 |
| `summary.by_screen_type` | 画面種別ごとの画像数・正答率 |
| `summary.duration_ms` | 画像ごとの平均処理時間から算出した合計・平均・percentile |
| `summary.failures` | OCR 失敗、または比較対象フィールドが 0 のファイル |
| `results[].diffs` | 画像ごとの不一致フィールド |
| `results[].warnings` | OCR 実行時の warning |
| `results[].debug_dir` | debug 成果物の出力先 |

終了コードは、`summary.failures` が空なら `0`、1 件以上あれば `1` です。入力ディレクトリが存在しない、またはフィルタ後の対象が 0 件の場合は `2` です。

## 分析時の注意

- `timing` モードの `--repeat` は同一 Python プロセス内の内側ループです。チューニング前後の比較では、同じサンプル・同じ `--repeat`・同じ実行環境で複数回実行して比較してください。
- `--limit` は `(対戦No., slotPrefix)` のソート後に適用されます。ランダム抽出ではありません。
- プレイヤー照合はまず `プレー順` で行い、外れた場合は `プレーヤー名` の表記ゆれで救済します。名前救済が発生した場合、`<play_order_missed>` が diff に記録されます。
- holdout サンプルを使う場合は、チューニングに使った train サンプルと分けてレポートを保存してください。
