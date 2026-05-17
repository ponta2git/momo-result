# 2026-05-15 API Architecture Remediation Handoff

## 対象

- `apps/web`

## 概要

今回の `apps/api` 改修は、主に repository 契約・in-memory test double・開催削除の内部トランザクション境界を整理したもの。HTTP DTO、OpenAPI schema、Redis Streams / OCR queue payload の破壊的変更はない。

## apps/web への申し送り

### 1. 追加対応は不要

- `apps/api/openapi.yaml` に差分はない。
- `sbt apiOpenApiCheck` を含む `sbt apiQuality` は通過済み。
- match / master / login account / held event の公開 DTO は変更していない。

### 2. 開催削除の 409 は従来どおり conflict として扱う

開催削除は API 内部で `HeldEventDeletionRepository` に集約され、Postgres では参照確認と削除を単一トランザクション境界に寄せた。

公開 endpoint は変わらない。web 側は従来どおり `409` / `ProblemDetails.code = CONFLICT` を削除不可として扱えばよい。

既存メッセージ:

- `held event has confirmed matches.`
- `held event has match drafts.`

防御的 fallback として、想定外 FK 参照時に以下の detail が返り得る:

- `held event is still referenced.`

detail 文字列への厳密分岐は避け、`CONFLICT` を削除不可として扱うのが望ましい。
