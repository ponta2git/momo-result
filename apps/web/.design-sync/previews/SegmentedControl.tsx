import { SegmentedControl } from "momo-result-ui";

export const PeriodFilter = () => (
  <SegmentedControl
    label="集計期間"
    onValueChange={() => {}}
    options={[
      { label: "今シーズン", value: "season" },
      { label: "直近10試合", value: "recent" },
      { label: "通算", value: "all" },
    ]}
    value="season"
  />
);

export const MetricSwitch = () => (
  <SegmentedControl
    label="比較する指標"
    onValueChange={() => {}}
    options={[
      { label: "総資産", value: "assets" },
      { label: "収益", value: "revenue" },
      { label: "目的地", value: "destinations" },
      { label: "順位", value: "rank" },
    ]}
    value="revenue"
  />
);

export const DisabledOption = () => (
  <SegmentedControl
    label="表示年数"
    onValueChange={() => {}}
    options={[
      { label: "3年", value: "3" },
      { label: "10年", value: "10" },
      { label: "50年", value: "50" },
      { label: "100年", disabled: true, value: "100" },
    ]}
    value="10"
  />
);

export const Disabled = () => (
  <SegmentedControl
    disabled
    label="表示形式"
    onValueChange={() => {}}
    options={[
      { label: "表", value: "table" },
      { label: "グラフ", value: "chart" },
    ]}
    value="table"
  />
);
