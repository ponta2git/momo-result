import { InputControl } from "momo-result-ui";

export const Default = () => (
  <div className="grid gap-3">
    <InputControl aria-label="開催名" defaultValue="第12回 桃鉄リーグ" />
    <InputControl aria-label="プレイヤー名" placeholder="プレイヤー名を入力" />
  </div>
);

export const Types = () => (
  <div className="grid gap-3 sm:grid-cols-2">
    <InputControl aria-label="開催日" defaultValue="2026-10-18" type="date" />
    <InputControl aria-label="プレイ年数" defaultValue={30} textAlign="end" type="number" />
    <InputControl aria-label="開催を検索" placeholder="開催名で検索" type="search" />
    <InputControl aria-label="開始時刻" defaultValue="21:00" type="time" />
  </div>
);

export const States = () => (
  <div className="grid gap-3">
    <InputControl aria-label="総資産" defaultValue="12億" invalid />
    <InputControl aria-label="マップ" defaultValue="日本マップ" disabled />
  </div>
);

export const Tones = () => (
  <div className="grid gap-3 sm:grid-cols-2">
    <InputControl
      aria-label="ももたろう の総資産"
      defaultValue="128,400"
      textAlign="end"
      tone="action"
    />
    <InputControl
      aria-label="きんたろう の総資産"
      defaultValue="97,200"
      textAlign="end"
      tone="review"
    />
    <InputControl
      aria-label="うらしま の総資産"
      defaultValue="64,850"
      textAlign="end"
      tone="success"
    />
    <InputControl
      aria-label="かぐや の総資産"
      defaultValue="31,300"
      textAlign="end"
      tone="warning"
    />
  </div>
);

export const Compact = () => (
  <div className="flex gap-2">
    <InputControl
      aria-label="順位"
      defaultValue={1}
      density="compact"
      textAlign="center"
      type="number"
    />
    <InputControl
      aria-label="目的地到着回数"
      defaultValue={9}
      density="compact"
      textAlign="center"
      type="number"
    />
  </div>
);
