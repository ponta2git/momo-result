# Public Postmortem Policy

目的: public repository には再発防止に必要な抽象教訓だけを残し、具体的な障害位置や再現条件を公開しない。

## Public

[lessons.md](lessons.md) は、該当する変更で思い出す教訓カードと恒久ルールへの参照を持つ。具体的な affected endpoint、component、ファイル、再現手順、時系列、残リスクは含めない。

## Private

個別 postmortem、follow-up tracker、調査ログ、詳細原因、再現手順、残リスクは `private/post-mortem/` に置く。
公開範囲と private の参照条件は [AGENTS.md](../../AGENTS.md) に従う。

## 作業の入口

インシデント分析・レビュー・対策の再評価は [postmortem skill](../../.agents/skills/postmortem/SKILL.md) を使う。通常の実装では関連する教訓カードを参照する。

教訓を残す前に、既存の実装や規約で何が不足していたか、新しい対策が維持に見合うかを判断する。恒久ルールが必要なら [文書索引](../README.md) に従って専門正本へ置き、カードには思い出す条件と確認事項を残す。同じ教訓の重複や、単発の失敗から全変更へ課す手順を増やさない。
