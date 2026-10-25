import { FactList } from "momo-result-ui";

export const MatchSummary = () => (
  <FactList
    ariaLabel="第12回の概要"
    columns={2}
    items={[
      { id: "date", label: "開催日", value: "2026/10/24" },
      { id: "years", label: "プレイ年数", value: "30年" },
      { id: "winner", label: "優勝", value: "ももたろう" },
      { id: "assets", label: "優勝者の総資産", value: "128,400万円" },
    ]}
  />
);

export const Inline = () => (
  <FactList
    ariaLabel="ももたろうの成績"
    items={[
      { id: "rank", label: "最終順位", value: "1位" },
      { id: "assets", label: "総資産", value: "128,400万円" },
      { id: "revenue", label: "収益", value: "23,500万円" },
      { id: "destinations", label: "目的地到着", value: "9回" },
    ]}
    layout="inline"
  />
);

export const FourColumns = () => (
  <FactList
    ariaLabel="シリーズ通算"
    columns={4}
    items={[
      { id: "matches", label: "試合数", value: "12試合" },
      { id: "wins", label: "優勝回数", value: "5回" },
      { id: "avgRank", label: "平均順位", value: "1.8位" },
      { id: "avgAssets", label: "平均総資産", value: "86,200万円" },
    ]}
  />
);

export const SingleColumn = () => (
  <FactList
    ariaLabel="採点基準"
    items={[
      { id: "assets", label: "総資産", value: "最終決算時点の総資産を順位ごとに比べます。" },
      { id: "revenue", label: "収益", value: "1年あたりの平均収益で比べます。" },
    ]}
  />
);
