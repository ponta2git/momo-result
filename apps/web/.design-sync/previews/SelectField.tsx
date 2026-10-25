import { SelectField } from "momo-result-ui";

const titles = [
  { label: "桃太郎電鉄ワールド", value: "world" },
  { label: "桃太郎電鉄 昭和 平成 令和も定番！", value: "teiban" },
  { label: "桃太郎電鉄2", value: "momotetsu2" },
];

export const Basic = () => (
  <div className="w-72">
    <SelectField label="対象作品" options={titles} defaultValue="world" />
  </div>
);

export const WithDescription = () => (
  <div className="w-72">
    <SelectField
      description="選んだシーズンの試合だけでレーダーを比較します。"
      label="比較するシーズン"
      options={[
        { label: "2026 春シーズン", value: "2026-spring" },
        { label: "2026 夏シーズン", value: "2026-summer" },
        { label: "2026 秋シーズン", value: "2026-autumn" },
      ]}
      defaultValue="2026-autumn"
    />
  </div>
);

export const RequiredWithError = () => (
  <div className="w-72">
    <SelectField
      error="マップを選んでください。"
      label="使用マップ"
      options={[
        { label: "日本マップ", value: "japan" },
        { label: "世界マップ", value: "world" },
      ]}
      required
    />
  </div>
);

export const FilterRow = () => (
  <div className="grid max-w-lg grid-cols-2 gap-4">
    <SelectField
      label="履歴の作品"
      options={[{ label: "全作品", value: "" }, ...titles]}
      defaultValue=""
    />
    <SelectField
      disabled
      label="比較するマップ"
      options={[{ label: "日本マップ", value: "japan" }]}
      defaultValue="japan"
    />
  </div>
);
