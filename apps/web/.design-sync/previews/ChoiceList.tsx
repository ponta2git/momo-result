import { ChoiceList } from "momo-result-ui";

const noop = () => {};

export const Default = () => (
  <ChoiceList
    legend="プレイ年数"
    name="years"
    options={[
      { value: "10", label: "10年", description: "1開催で2試合できる短めの設定です。" },
      { value: "30", label: "30年", description: "標準の長さ。リーグ戦の基本ルールです。" },
      { value: "50", label: "50年", description: "決勝戦などの特別な開催向けです。" },
    ]}
    value="30"
    onValueChange={noop}
  />
);

export const DisabledAndPending = () => (
  <ChoiceList
    legend="マップ"
    name="map"
    options={[
      { value: "japan", label: "日本マップ", description: "全国の物件駅を巡る標準マップ。" },
      { value: "world", label: "世界マップ", pending: true, description: "候補を読み込み中です。" },
      {
        value: "heisei",
        label: "平成マップ",
        disabled: true,
        description: "今シーズンは対象外です。",
      },
    ]}
    value="japan"
    onValueChange={noop}
  />
);

export const Empty = () => (
  <ChoiceList
    emptyState="このシーズンに登録された開催はまだありません。"
    legend="開催"
    name="event"
    options={[]}
    onValueChange={noop}
  />
);
