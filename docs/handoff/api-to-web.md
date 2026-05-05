# API → Web 申し送り（apps/api ブラッシュアップ完了時点）

`apps/api` のアーキテクチャ・ブラッシュアップ（Phase 0〜5）が完了した。`apps/web` 実装で前提にしてよい契約と、追従が必要な変更点をここに集約する。

---

## 1. 必読

- `docs/architecture.md` — 実装規約（変更なし）
- `docs/domain-rule.md` — ドメイン用語（変更なし）
- `apps/api/docs/proposals/idempotency-keys.md` — Idempotency-Key の仕様詳細
- 自動生成: `apps/api` から openapi.json を取得し、`apps/web` で `openapi-typescript` により型再生成

---

## 2. OpenAPI 取得と型再生成

API の endpoint 定義は **Tapir が source of truth**。`apiQuality` の `openApiCheck` でリポジトリ内の OpenAPI 仕様と diff を検出する。

- web 側は `openapi-typescript` で API 型を再生成し、`fetch` ラッパで利用する。
- 再生成後、`pnpm --filter @momo/web typecheck` を必ず通すこと。

---

## 3. 認証・CSRF（変更なし、再確認のみ）

| 項目 | 値 |
|---|---|
| ログイン | Discord OAuth |
| Session | HttpOnly Secure Cookie（PostgreSQL 永続） |
| Cookie | SameSite=Lax |
| CSRF | 状態変更系 API は `X-CSRF-Token` 必須 |
| Dev override | `X-Dev-User: <member_id>`（Dev/Test 環境のみ。Prod では production session middleware が処理する） |

`AuthPolicy` trait で dev/prod を集約済み。web からは環境差を意識せず、常に Cookie + `X-CSRF-Token` を送れば良い。

---

## 4. エラーレスポンス（RFC 7807 風）

全エラーは下記の `ProblemDetails` で返る。`fetch` ラッパで一律にこの形を期待してよい。

```json
{
  "type":   "https://momo-result.local/problems/<lower_code>",
  "title":  "Unauthorized",
  "status": 401,
  "detail": "human readable detail",
  "code":   "UNAUTHORIZED"
}
```

- `code` は安定したマシン可読の識別子（switch で UI 分岐に使う）
- `status` は HTTP status と一致
- 既存の `409 Conflict` などはこの形で来る（後述 Idempotency 含む）

主な `code`:
- `UNAUTHORIZED` / `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_FAILED`
- `IDEMPOTENCY_CONFLICT`（同一 key で異なる body）
- `INTERNAL_ERROR`

---

## 5. ⭐ Idempotency-Key（**新規・重要**）

### 5.1 対象 endpoint

副作用ある Create / Update 系のみ。GET / DELETE / 読み取り系は対象外。

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/held-events` | 開催作成 |
| POST | `/api/match-drafts` | 試合下書き作成 |
| PATCH | `/api/match-drafts/{id}` | 試合下書き更新 |
| POST | `/api/matches` | 試合確定 |
| POST | `/api/ocr-jobs` | OCR ジョブ投入 |
| POST | `/api/game-titles` | ゲームタイトル作成 |
| POST | `/api/map-masters` | マップマスタ作成 |
| POST | `/api/season-masters` | シーズンマスタ作成 |

### 5.2 動作仕様

リクエストヘッダ `Idempotency-Key: <client-generated-uuid>` を付けると以下の動作になる。

| 状態 | 結果 |
|---|---|
| key なし | 通常実行（idempotency 機能オフ） |
| key 初回 | 通常実行 + 24h 保存 |
| 同一 key + 同一 body | **保存済みレスポンスを再生（usecase は再実行されない）** |
| 同一 key + 異なる body | **HTTP 409 Conflict**（`code: IDEMPOTENCY_CONFLICT`） |
| 24h 経過後の同一 key | 期限切れとして新規実行扱い |

- key スコープは `(key, member_id, endpoint)` の複合キー。member ごと・endpoint ごとに独立。
- body の同一性判定は **canonical JSON**（keys ソート + 空白なし）の SHA-256。
  - Web 側は **JSON フィールドの並びや空白を気にする必要なし**。サーバ側で正規化される。
- レスポンスは body のみ再生される。Cookie 等は再付与されない（mutation の冪等再生では不要）。

### 5.3 Web 実装ガイド

```ts
// 推奨パターン
import { v4 as uuid } from 'uuid';

async function postHeldEvent(payload: HeldEventCreate) {
  const idemKey = uuid();
  return fetcher('/api/held-events', {
    method: 'POST',
    headers: {
      'X-CSRF-Token': csrf,
      'Idempotency-Key': idemKey, // submit 直前に1回だけ生成、retry でも同じ値を使い回す
    },
    body: JSON.stringify(payload),
  });
}
```

- **Idempotency-Key は submit 単位で 1 つ生成**（retry や手動再送では使い回す）。
- React Hook Form / Conform の onSubmit 開始時に発行 → 成功 / 最終失敗まで同じ key を使う。
- ネットワーク再送・楽観的 UI のロールバック復帰など、**重複実行を起こしたくない経路**で必ず付ける。
- 差分 PATCH を再送するときも、**同じ payload を再送するなら同じ key**。payload を更新したら新しい key を発行する。

### 5.4 409 IDEMPOTENCY_CONFLICT の UI 扱い

`409 IDEMPOTENCY_CONFLICT` はクライアント側のロジックバグ（key 使い回しの誤り）の signal。
通常のユーザーフローでは出ないはずなので、UI には「内部エラー、ページを再読み込みしてください」程度で良い。
verbose 表示は不要だが、ログにだけ詳細を残す価値はある。

---

## 6. 試合データの形（変更なし、再確認のみ）

- 1 試合 = 必ずプレイヤー 4 名（順位 1〜4 が一意・全員揃って初めて確定可能）
- 順位は OCR / 手修正の値が正本。資産額は ten-thousand-yen 単位の **整数**。
- API レスポンスの players 配列は **必ず 4 件**（API 側で `FourPlayers` 型により保証）。Web は length 1〜3 を考慮しなくて良い。
- 下書き状態は `editing` / `confirmed` / `cancelled` の 3 状態 ADT。
- OCR ジョブ状態は `queued` / `running` / `succeeded` / `failed` / `cancelled`。

---

## 7. ID 型について

API 内部では opaque type（`MemberId` `MatchId` `MatchDraftId` 等 12 種）で型安全化された。
OpenAPI レベルでは依然 `string`（UUID または slug）として表現されるため、**web 側の TS 型に直接の影響はない**。
ただし、ID を別 ID と取り違える混入バグは API 側で検出される（混乱した state がそのまま DB に届くことはない）。

> 推奨: web 側でも branded type（例: `type MemberId = string & { __brand: 'MemberId' }`）で 12 ID を区別すると、API 契約とのズレを早期検出できる。MVP 必須ではない。

---

## 8. 画像アップロード（変更なし、再確認のみ）

- PNG / JPEG / WebP のみ、最大 3MB
- multipart/form-data で `POST /api/uploads/...`
- アップロード画像は OCR 完了まで保持、その後サーバ側で削除
- DB には slot 別 source image ID のみ保存。**長寿命 URL は発行されない**
- 編集中は `GET /api/match-drafts/{id}/source-images/{slot}` で取得可能（OCR 完了まで）

---

## 9. CSV / TSV ダウンロード（変更なし、再確認のみ）

- ログイン UI からのみ取得可能（rate limit 対象）
- 1 行 1 プレイヤー結果、列順は `docs/requirements/base.md` 準拠

---

## 10. レート制限

以下の経路に light rate limiting あり。429 を受け取ったら指数バックオフで再試行。

- ログイン
- 画像アップロード
- CSV / TSV ダウンロード

---

## 11. テスト時の注意

- `apps/api` の InMemory adapter で動かす dev mode と、Postgres backed の prod mode で **挙動同等性は API 側 contract spec で担保済み**。Web E2E ではどちらも同じ振る舞いを期待してよい。
- Idempotency も InMemory（Ref-backed）で同じ仕様で動く。

---

## 12. 既知の保留事項（後続タスク）

- `idempotency_keys` の expired row cleanup は **DB 側 cron（または定期 job）に未実装**。
  当面は数日分溜まっても影響軽微だが、運用 1 ヶ月程度で `DELETE WHERE expires_at < now()` の定期実行を仕込む必要あり。
- web 側の Idempotency 組み込みは web Phase で実施（このドキュメントが入口）。
