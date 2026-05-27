# ドメインルール

目的: 用語、不変条件、状態遷移の正本。

読む条件:

- 試合、下書き、OCR、認証主体、マスタ、開催回を触る。
- API request / response、DB row、UI state の意味を判断する。

優先:

- 業務要件: `docs/requirements/base.md`
- 技術構造: `docs/architecture.md`
- DB所有権: `docs/db-rule.md`

## 1. Terms

| 用語 | DB/概念 | 意味 |
|---|---|---|
| 開催回 | `held_events` | 1夜の桃鉄会。複数試合を含み得る。 |
| 試合 | `matches` | 桃鉄1年勝負の1回分。開催回に属する。 |
| 下書き | `match_drafts` | OCRまたは手入力から確定前に編集する試合候補。 |
| 試合参加者 | `match_players` | 1試合における1名の結果。 |
| 事件記録 | `match_incidents` | 1試合・1プレーヤー・1事件マスタの回数。 |
| プレーヤー | `members` | summit と共有する固定4名。 |
| ログインアカウント | `momo_login_accounts` | Discord OAuth でログイン可能な操作主体。試合参加者とは別概念。 |
| エイリアス | `member_aliases` | OCR上の名前を正式 member に寄せるマッピング。 |
| OCRドラフト | `ocr_drafts` | 画像1枚のOCR解析結果。 |
| OCRジョブ | `ocr_jobs` | 画像アップロードからOCR完了/失敗までの非同期ジョブ。 |

## 2. Match Invariants

試合確定に必要な値:

- 開催日時
- ゲームタイトル
- シーズン
- オーナー
- マップ
- 固定4名全員のプレー順
- 固定4名全員の順位

不変条件:

- 順位は 1〜4 の重複なし整数。資産額から自動計算しない。
- プレー順は固定4名全員について重複なし。画像由来の場合は画面下の色順（青、赤、黄、緑）から判別し、手修正可能にする。
- 固定4名の member id / 表示名 / 初期プレー順は業務不変条件。UI定数として局所修正しない。
- 将来プレーヤー追加・入れ替えを扱う場合は、`members` の所有権を API 契約へ移す設計変更として扱う。

数値:

- 資産・収益は整数で保存する。
- 単位は万円。例: `10000` は 1億円。
- 表示フォーマットは UI の責務。
- CSV/TSV の列順は `docs/requirements/base.md` を正本にする。

## 3. Actor Model

- ログインアカウントは試合参加者ではない。
- `momo_login_accounts.player_member_id` があるアカウントは対応する `members` に任意で紐づく。
- `player_member_id = NULL` のアカウントも戦績操作は可能。
- 作成者は `created_by_account_id` を正とする。対応プレーヤーがいる場合だけ `created_by_member_id` も保存する。
- 管理者権限は `is_admin`。最低1名の有効な管理者を維持する。
- `login_enabled = false` のアカウントはログイン不可。無効化時は既存 session を削除する。

## 4. OCR To Match Flow

```text
画像アップロード
  -> OCRジョブ作成（DB記録 + Redis queue/outbox）
  -> OCR worker 処理
  -> OCRドラフト保存
  -> ユーザーが match_draft を手修正
  -> 確定（matches / match_players / match_incidents）または下書き削除
  -> 下書き確定または削除時に元画像削除
```

ルール:

- 画像なしの手入力だけでも確定できる。
- 同じOCR対象画面種別を複数取り込んだ場合は最新結果で上書きする。
- 未確定下書きは作業中の間だけDBに残る。削除時は元画像保持を閉じ、`match_drafts` を物理削除する。
- `confirmed` は終端状態。確定 usecase の副作用とセットでだけ到達する。
- `cancelled` は過去データ互換の終端状態であり、新規のユーザー削除では残さない。
- OCR失敗はジョブ失敗として記録し、空の手入力下書きとして続行できる導線を残す。
- 低信頼度や警告は確認画面でユーザーが判断できる形にする。

## 5. Match Confirmation Modes

同じ `matches` 作成でも2つの意味論がある。

| 経路 | 識別子 | 副作用 |
|---|---|---|
| 手入力 / 画像なしの直接作成 | `matchDraftId` なし | `matches` / `match_players` / `match_incidents` を作成する。`match_drafts` は触らない。 |
| OCR下書きからの確定 | `matchDraftId` あり | `matches` / `match_players` / `match_incidents` を作成し、元 `match_drafts` を `confirmed` にして `confirmed_match_id` を保存し、元画像保持を閉じる。 |

`draftIds` は確定済み試合が参照した OCR 結果の履歴であり、元作業単位を閉じる識別子ではない。OCR下書き確定では `draftIds` だけでなく `matchDraftId` を API に渡す。

## 6. Masters / Held Events

- マスタは `momo-db` 管理。変更には `momo-db` の schema / migration / seed 変更が必要。
- 対象マスタ: `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases`
- MVP固定事件: 目的地、プラス駅、マイナス駅、カード駅、カード売り場、スリの銀次
- 1つの開催回に複数試合を紐づけられる。
- 試合番号は同じ開催回内で採番し、必要に応じて手動変更できる。
- 本アプリから作成した開催回は `held_events.session_id = NULL` になり得る。
