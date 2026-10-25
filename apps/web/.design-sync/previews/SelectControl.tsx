import { SelectControl } from "momo-result-ui";

const players = [
  { label: "ももたろう", value: "momotaro" },
  { label: "きんたろう", value: "kintaro" },
  { label: "うらしま", value: "urashima" },
  { label: "かぐや", value: "kaguya" },
];

export const Selected = () => (
  <div className="w-64">
    <SelectControl aria-label="プレイヤー" defaultValue="momotaro" options={players} />
  </div>
);

export const Tones = () => (
  <div className="grid w-64 gap-2">
    <SelectControl
      aria-label="1位のプレイヤー"
      defaultValue="momotaro"
      options={players}
      tone="action"
    />
    <SelectControl
      aria-label="2位のプレイヤー"
      defaultValue="kintaro"
      options={players}
      tone="review"
    />
    <SelectControl
      aria-label="3位のプレイヤー"
      defaultValue="urashima"
      options={players}
      tone="success"
    />
    <SelectControl
      aria-label="4位のプレイヤー"
      defaultValue="kaguya"
      options={players}
      tone="warning"
    />
  </div>
);

export const CompactAndInvalid = () => (
  <div className="grid w-64 gap-2">
    <SelectControl
      aria-label="順位"
      defaultValue="2"
      density="compact"
      options={[
        { label: "1位", value: "1" },
        { label: "2位", value: "2" },
        { label: "3位", value: "3" },
        { label: "4位", value: "4" },
      ]}
    />
    <SelectControl aria-label="プレイヤー" invalid options={players} />
  </div>
);

export const Disabled = () => (
  <div className="w-64">
    <SelectControl
      aria-label="対象作品"
      defaultValue="world"
      disabled
      options={[
        { label: "桃太郎電鉄ワールド", value: "world" },
        { label: "桃太郎電鉄 昭和 平成 令和も定番！", value: "teiban" },
      ]}
    />
  </div>
);
