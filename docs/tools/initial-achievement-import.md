# 実績の初期投入 command

目的: 実績リストの定義と、提供 TSV に含まれる個人の達成情報（移行根拠）を consumer の初期化 command で投入する入口を示す。保存契約、dry-run と apply、再実行の冪等性は [DB 規約の Achievement Data](../db-rule.md#achievement-data)、業務上の移行規則は [実績要求の初期移行](../requirements/player-achievements.md#6-初期移行) を正本とする。引数名と入力検査の現在値は command の実装（`momo.api.tools.InitialAchievementImport` と `InitialAchievementInput`）を正本とし、ずれた場合は実装を直すか本書を更新する。

## 実行

`apps/api` で次を実行する。接続先は `DATABASE_URL` で選ぶ。既定は読み取りだけの dry-run で、`--apply` を加えた場合だけ保存する。

```text
sbt --server --batch "runMain momo.api.tools.InitialAchievementImport --manifest <manifest.json> --mapping <mapping.json> --tsv <source.tsv>"
```

本番 DB への適用は [公開運用規約](../ops/README.md) の承認境界に従う。隔離 DB での dry-run・apply は通常のローカル検証として進められる。

## 入力

| 入力 | 内容 |
| --- | --- |
| manifest | `.momo-db-ref` に固定した `momo-db` の `seeds/momotetsu2-achievements-v1.json`。項目の固定 ID・条件・星・備考を持つ |
| mapping | 作品・東日本 / 西日本マップ・実行 account（有効な運用担当または管理者）と、TSV の4列を既存 member へ対応づける明示 JSON。`gameTitleId`、`eastMapId`、`westMapId`、`accountId` と、TSV 順の4件の `players: [{"column": "TSVの列名", "memberId": "既存ID"}]` を持つ |
| tsv | 提供された実績リストの TSV。個人の達成記号を含む |

自動判定項目の達成記号は形式の検証だけに使う（達成は Worker の自動判定で決まる）。手入力項目の「達成！」「達成？」の扱いは実績要求に従う。
