import { CheckboxField, StatusBadge } from "momo-result-ui";

export const States = () => (
  <div className="grid gap-2">
    <CheckboxField defaultChecked label="ももたろう を参加者に含める" />
    <CheckboxField label="きんたろう を参加者に含める" />
    <CheckboxField disabled label="うらしま を参加者に含める（欠席）" />
  </div>
);

export const WithDescription = () => (
  <CheckboxField
    defaultChecked
    description="チェックを外すと、この開催の試合はシーズン順位の集計から除外されます。"
    label="シーズン順位に反映する"
  />
);

export const WithError = () => (
  <CheckboxField
    error="結果を確定する前に、全員の総資産を確認してください。"
    label="入力内容を確認しました"
    required
  />
);

export const WithStatus = () => (
  <CheckboxField
    defaultChecked
    label="第12回 桃鉄リーグを公開する"
    status={<StatusBadge label="公開中" tone="success" />}
  />
);
