import { ChoicePickerDialogField } from "momo-result-ui";

const noop = () => {};

const events = [
  { value: "e12", label: "第12回 桃鉄リーグ", description: "2026/10/18・日本マップ・30年" },
  { value: "e11", label: "第11回 桃鉄リーグ", description: "2026/09/20・日本マップ・30年" },
  { value: "e10", label: "夏の特別戦", description: "2026/08/15・世界マップ・50年" },
];

export const Selected = () => (
  <ChoicePickerDialogField
    label="開催"
    name="event"
    options={events}
    selectedLabel="第12回 桃鉄リーグ（2026/10/18）"
    value="e12"
    onValueChange={noop}
  />
);

export const RequiredWithError = () => (
  <ChoicePickerDialogField
    error="試合を登録する開催を選んでください。"
    label="開催"
    name="event-required"
    options={events}
    recovery
    required
    selectedLabel="未選択"
    onValueChange={noop}
  />
);

export const Disabled = () => (
  <ChoicePickerDialogField
    disabled
    label="マップ"
    name="map"
    options={[{ value: "japan", label: "日本マップ" }]}
    selectedLabel="日本マップ"
    value="japan"
    onValueChange={noop}
  />
);
