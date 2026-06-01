# Public Postmortem Policy

目的: public repository には再発防止に必要な抽象教訓だけを残し、具体的な障害位置や再現条件を公開しない。

## Public

- `docs/post-mortem/lessons.md`
  - 完了前に確認する短い教訓カード。
  - durable rule の参照先。
  - 具体的な affected endpoint、component、ファイル、再現手順、時系列、残リスクは含めない。

## Private

個別 postmortem、follow-up tracker、調査ログ、詳細原因、再現手順、残リスクは `private/post-mortem/` に置く。
`private/post-mortem/` は git 管理外であり、ユーザーが明示した場合だけ読む。

## Skill Compatibility

postmortem 作業の入口は引き続き `docs/post-mortem/lessons.md` とする。新しい事故から恒久ルールを抽出したら、public には抽象化した lessons だけを反映し、詳細記録は private に置く。
