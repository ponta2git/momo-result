# ドメインルール

目的: 用語、不変条件、状態遷移、識別子の意味を判断するための正本。

読む条件:

- 試合、下書き、OCR、認証主体、マスタ、開催回を触る。
- API request / response、DB row、UI state の意味を判断する。
- optional field の有無で mode や副作用が変わる実装を変更する。

参照:

- 業務要件・CSV/TSV列順: `docs/requirements/base.md`
- 実装境界: `docs/architecture.md`
- DB所有権: `docs/db-rule.md`
- Redis/OCR queue: `docs/redis-streams-ocr-contract.md`

## 1. Terms

| 用語 | DB/概念 | 意味 |
|---|---|---|
| 開催回 | `held_events` | 1夜の桃鉄会。複数試合を含み得る。 |
| 試合 | `matches` | 桃鉄1年勝負の1回分。開催回に属する確定済み結果。 |
| 試合番号 | `matches.match_no_in_event` | 同一開催回内の1始まり番号。重複不可。 |
| 下書き | `match_drafts` | OCRまたは手入力から確定前に編集する作業単位。 |
| OCRドラフト | `ocr_drafts` | 画像1枚のOCR解析結果。 |
| OCRジョブ | `ocr_jobs` | 画像アップロードからOCR完了/失敗までの非同期ジョブ。 |
| 試合参加者 | `match_players` | 1試合における1名の結果。 |
| 事件記録 | `match_incidents` | 1試合・1プレーヤー・1事件マスタの回数。 |
| プレーヤー | `members` | summit と共有する固定4名。 |
| ログインアカウント | `momo_login_accounts` | Discord OAuth でログイン可能な操作主体。試合参加者とは別概念。 |
| エイリアス | `member_aliases` | OCR上の名前を正式 member に寄せるマッピング。 |

## 2. Actor Model

- ログインアカウントは試合参加者ではない。
- `momo_login_accounts.player_member_id` があるアカウントは対応する `members` に任意で紐づく。
- `player_member_id = NULL` のアカウントも、認可されていれば戦績操作は可能。
- 作成者は `created_by_account_id` を正とする。対応プレーヤーがいる場合だけ `created_by_member_id` も保存する。
- 管理者権限は `is_admin`。最低1名の有効な管理者を維持する。
- `login_enabled = false` のアカウントはログイン不可。無効化時は既存 session を削除する。
- dev/test の `X-Momo-Account-Id` は検証用の操作主体選択であり、本番認証主体として扱わない。

## 3. Match Invariants

試合確定に必要な値:

- 開催回
- 試合番号
- 開催日時
- ゲームタイトル
- シーズン
- オーナー
- マップ
- 固定4名全員のプレー順
- 固定4名全員の順位

プレーヤー不変条件:

- 試合参加者は固定4名ちょうど。
- `memberId` は重複不可で、許可された固定4名に含まれる。
- 順位は `1..4` の重複なし整数。資産額から自動計算しない。
- プレー順は `1..4` の重複なし整数。画像由来の場合は画面下の色順（青、赤、黄、緑）から判別し、手修正可能にする。
- 固定4名の member id / 表示名 / 初期プレー順は業務不変条件。UI定数として局所修正しない。
- 将来プレーヤー追加・入れ替えを扱う場合は、`members` の所有権とAPI契約を見直す設計変更として扱う。

数値:

- 資産・収益は整数で保存する。
- 単位は万円。例: `10000` は 1億円。
- 事件回数は0以上の整数。
- 表示フォーマットは UI の責務。
- CSV/TSV の列順は `docs/requirements/base.md` を正本にする。

## 4. OCR / Draft Lifecycle

```text
画像アップロード
  -> OCRジョブ作成（DB記録 + Redis queue/outbox）
  -> OCR worker 処理
  -> OCRドラフト保存
  -> ユーザーが match_draft を手修正
  -> 確定（matches / match_players / match_incidents）または下書き削除
  -> 下書き確定または削除時に元画像削除
```

下書き状態:

| 状態 | 意味 | 編集 | 終端 |
|---|---|---:|---:|
| `ocr_running` | 1つ以上のOCR slotが処理待ちまたは処理中 | 不可 | No |
| `ocr_failed` | 1つ以上のOCR slotが失敗またはcancelled | 可 | No |
| `draft_ready` | OCR slotが揃い、警告なしで編集可能 | 可 | No |
| `needs_review` | OCR結果に警告があり確認が必要 | 可 | No |
| `confirmed` | 確定済み試合へ閉じた | 不可 | Yes |
| `cancelled` | 削除・中止済みの互換終端状態 | 不可 | Yes |

ルール:

- 画像なしの手入力だけでも確定できる。
- OCR対象画面種別は `total_assets`、`revenue`、`incident_log`。`auto` は新規OCR用で、既存下書きのslotへ attach しない。
- 同じOCR対象画面種別を複数取り込んだ場合は、該当slotを最新結果で上書きする。
- `ocr_running` の投影状態は slot job の状態から決める。未完了があれば `ocr_running`、失敗があれば `ocr_failed`、警告があれば `needs_review`、それ以外は `draft_ready`。
- 未確定下書きは作業中の間だけDBに残る。ユーザー削除時は元画像保持を閉じ、editable下書きを物理削除する。
- `confirmed` は確定 usecase の副作用とセットでだけ到達する。
- `cancelled` は互換用の終端状態であり、確定やOCR開始へ戻さない。
- OCR失敗はジョブ失敗として記録し、空の手入力下書きとして続行できる導線を残す。
- 低信頼度や警告は確認画面でユーザーが判断できる形にする。

## 5. Match Confirmation Modes

同じ `matches` 作成でも2つの意味論がある。

| 経路 | 識別子 | 副作用 |
|---|---|---|
| 手入力 / 画像なしの直接作成 | `matchDraftId` なし | `matches` / `match_players` / `match_incidents` を作成する。`match_drafts` は触らない。 |
| OCR下書きからの確定 | `matchDraftId` あり | `matches` / `match_players` / `match_incidents` を作成し、元 `match_drafts` を `confirmed` にして `confirmed_match_id` を保存し、元画像保持を閉じる。 |

`draftIds` は確定済み試合が参照したOCR結果の履歴であり、元作業単位を閉じる識別子ではない。OCR下書き確定では `draftIds` だけでなく `matchDraftId` を API に渡す。

OCR下書き確定時は、request の `draftIds.totalAssets` / `draftIds.revenue` / `draftIds.incidentLog` が `match_drafts` の現在slotと一致することを検証する。これにより、古い画面状態から別のOCR結果を確定する競合を防ぐ。

## 6. OCR Job Lifecycle

| 状態 | 意味 | 終端 |
|---|---|---:|
| `queued` | Redis配送済みまたは配送待ちで、worker未claim | No |
| `running` | workerがclaimして処理中 | No |
| `succeeded` | OCR結果を `ocr_drafts` に保存済み | Yes |
| `failed` | 失敗情報を保存済み | Yes |
| `cancelled` | 処理前に中止済み | Yes |

- OCRジョブ状態の正本はDB。Redis Streams は配送路。
- worker は `queued` を atomically claim して `running` にする。
- terminal transition は `queued` / `running` からのみ許可する。
- successful completion は、報告した draft payload と保存した payload が一致しなければならない。
- non-success completion は failure metadata を持ち、draft payload を持たない。

## 7. Masters / Held Events

- マスタは `momo-db` 管理。変更には `momo-db` の schema / migration / seed 変更が必要。
- 対象マスタ: `game_titles`, `map_masters`, `season_masters`, `incident_masters`, `member_aliases`
- `game_titles.layout_family` はOCR parser/profile selectionにも影響する。
- `game_titles.layout_family` は安定した profile key として扱い、`^[a-z][a-z0-9_]{0,63}$` に合う lowercase snake key だけを保存する。
- `map_masters` と `season_masters` は所属する `game_title_id` と矛盾してはならない。
- MVP固定事件: 目的地、プラス駅、マイナス駅、カード駅、カード売り場、スリの銀次
- 1つの開催回に複数試合を紐づけられる。
- 試合番号は同じ開催回内で採番し、必要に応じて手動変更できる。
- 本アプリから作成した開催回は `held_events.session_id = NULL` になり得る。
- 確定済み試合または有効な下書きがある開催回は、先に参照を解消しない限り削除しない。
