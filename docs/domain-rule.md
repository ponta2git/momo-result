# ドメインルール

この文書は実装者向けの用語・不変条件・フローの正本である。業務要求の正本は `docs/requirements/base.md`。

## 1. 用語

| 用語 | DB/概念 | 定義 |
|---|---|---|
| 開催回 | `held_events` | 1夜の桃鉄会。複数試合を含み得る。 |
| 試合 | `matches` | 桃鉄1年勝負の1回分。1つの開催回に属する。 |
| 下書き | `match_drafts` | OCRまたは手入力から確定前に編集する試合候補。 |
| 試合参加者 | `match_players` | 1試合における1名のプレーヤー結果。 |
| 事件記録 | `match_incidents` | 1試合・1プレーヤー・1事件マスタの回数。 |
| プレーヤー | `members` | summit と共有する固定4名。 |
| ログインアカウント | `momo_login_accounts` | Discord OAuth でログイン可能な操作主体。試合参加者とは独立する。 |
| エイリアス | `member_aliases` | OCR上の名前を正式 member に寄せるマッピング。 |
| OCRドラフト | `ocr_drafts` | 画像1枚のOCR解析結果。 |
| OCRジョブ | `ocr_jobs` | 画像アップロードからOCR完了/失敗までの非同期ジョブ。 |

## 2. 確定条件

試合確定には次がすべて必要。

- 開催日時
- ゲームタイトル
- シーズン
- オーナー
- マップ
- 固定4名全員のプレー順
- 固定4名全員の順位

順位は 1〜4 の重複なし整数。資産額から自動計算しない。OCRまたは手修正された順位を正とする。

プレー順は固定4名全員について重複なし。画像由来の場合は画面下の色順（青、赤、黄、緑）から判別し、手修正可能にする。

ログインアカウントは試合参加者ではない。`momo_login_accounts.player_member_id` があるアカウントは対応する `members` に紐づくが、`NULL` のアカウントも戦績操作は可能とする。将来、桃鉄の参加者入れ替えを扱う場合も、試合結果の参加者は `match_players.member_id`、操作主体は `created_by_account_id` として分離したまま拡張する。

## 3. 数値・単位

- 資産・収益は整数で保存する。
- 単位は万円。例: `10000` は 1億円。
- 表示フォーマットは UI の責務。
- CSV/TSV の列順は `docs/requirements/base.md` を正本にする。

## 4. OCRから確定まで

```text
画像アップロード
  -> OCRジョブ作成（DB記録 + Redis queue/outbox）
  -> OCR worker が処理
  -> OCRドラフト保存
  -> ユーザーが match_draft を手修正
  -> 確定（matches / match_players / match_incidents へ書き込み）
  -> 下書き確定またはキャンセル後に元画像削除
```

- 画像なしの手入力だけでも確定できる。
- 同じ種類の画像を複数取り込んだ場合は最新結果で上書きする。
- 未確定下書きはDB上に残る。元画像は保持期限・確定・キャンセルに従って削除する。
- OCR失敗はジョブ失敗として記録し、空の手入力下書きとして続行できる導線を残す。
- 低信頼度や警告は確認画面でユーザーが判断できる形にする。

### 4.1 試合確定の2経路

試合確定には同じ `matches` 作成でも2つの意味論がある。

| 経路 | 識別子 | 必須の副作用 |
|---|---|---|
| 手入力 / 画像なしの直接作成 | `matchDraftId` なし | `matches` / `match_players` / `match_incidents` を作成する。`match_drafts` は触らない。 |
| OCR下書きからの確定 | `matchDraftId` あり | `matches` / `match_players` / `match_incidents` を作成し、元 `match_drafts` を `confirmed` にして `confirmed_match_id` を保存し、元画像保持を閉じる。 |

`draftIds` は確定済み試合が参照した OCR 結果の履歴であり、元作業単位を閉じる識別子ではない。
OCR下書きから確定する経路では、`draftIds` だけでなく `matchDraftId` を必ず保持して API に渡す。

## 5. マスタ

マスタは `momo-db` 管理。変更には `momo-db` の schema / migration / seed 変更が必要。

| テーブル | 内容 |
|---|---|
| `game_titles` | 作品 |
| `map_masters` | 作品ごとのマップ |
| `season_masters` | シーズン |
| `incident_masters` | 事件名。MVPは6項目固定。 |
| `member_aliases` | OCR名寄せ用エイリアス |

MVPの固定事件:

- 目的地
- プラス駅
- マイナス駅
- カード駅
- カード売り場
- スリの銀次

## 6. 認証と操作主体

- Discord OAuth の照合先は `momo_login_accounts.discord_user_id`。
- `login_enabled = false` のアカウントはログイン不可。既存 session は無効化時に削除する。
- 管理者権限は `is_admin` で管理し、最低1名の有効な管理者を維持する。
- 試合・下書きの作成者は `created_by_account_id` を正とする。対応するプレーヤーがいる場合だけ `created_by_member_id` にも保存する。

## 7. 開催回と試合番号

- 1つの開催回に複数試合を紐づけられる。
- 試合番号は同じ開催回内で採番し、必要に応じて手動変更できる。
- 本アプリから作成した開催回は `held_events.session_id` が `NULL` になり得る。
