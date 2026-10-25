import { TextField } from "momo-result-ui";

export const Basic = () => (
  <div className="w-72">
    <TextField defaultValue="第12回 桃鉄リーグ" label="開催名" />
  </div>
);

export const WithDescription = () => (
  <div className="w-72">
    <TextField
      description="万円単位で入力します。マイナスの場合は先頭に - を付けます。"
      defaultValue="128400"
      inputMode="numeric"
      label="総資産"
      textAlign="end"
    />
  </div>
);

export const RequiredWithError = () => (
  <div className="w-72">
    <TextField
      error="プレイヤー名を入力してください。"
      label="プレイヤー名"
      placeholder="例: ももたろう"
      required
    />
  </div>
);

export const ScoreRow = () => (
  <div className="grid max-w-lg grid-cols-3 gap-4">
    <TextField defaultValue="23500" density="compact" label="収益" textAlign="end" tone="success" />
    <TextField defaultValue="9" density="compact" label="目的地" textAlign="end" />
    <TextField defaultValue="2026/10/24" disabled density="compact" label="開催日" />
  </div>
);
