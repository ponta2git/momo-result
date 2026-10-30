import { AppliedConditionChips } from "momo-result-ui";

const ignore = () => {};

export const MatchSearch = () => (
  <AppliedConditionChips
    conditions={[
      { key: "season", label: "シーズン: 2026春" },
      { key: "map", label: "マップ: 日本列島" },
      { key: "memo", label: "メモ: キングボンビー" },
    ]}
    onRemove={ignore}
  />
);

export const HeldEventSearch = () => (
  <div className="max-w-sm">
    <AppliedConditionChips
      conditions={[
        { key: "period", label: "期間: 2026/4/1〜2026/6/30" },
        { key: "matchCount", label: "確定試合数: 3試合以上" },
        { key: "metric", label: "ももたろう: 開催平均順位 2.00以下" },
      ]}
      onRemove={ignore}
    />
  </div>
);

export const Disabled = () => (
  <AppliedConditionChips
    conditions={[
      { key: "season", label: "シーズン: 2026春" },
      { key: "memo", label: "メモ: 目的地" },
    ]}
    disabled
    onRemove={ignore}
  />
);
