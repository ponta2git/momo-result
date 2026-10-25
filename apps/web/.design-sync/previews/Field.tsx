import { Field, InputControl, TextareaControl } from "momo-result-ui";

export const Default = () => (
  <Field htmlFor="field-event-name" label="開催名">
    <InputControl defaultValue="第12回 桃鉄リーグ" id="field-event-name" />
  </Field>
);

export const RequiredWithDescription = () => (
  <Field
    description="1〜100年の範囲で入力します。リーグ戦は通常30年です。"
    htmlFor="field-years"
    label="プレイ年数"
    required
  >
    <InputControl defaultValue={30} id="field-years" inputMode="numeric" type="number" />
  </Field>
);

export const WithError = () => (
  <Field
    error="総資産は数値で入力してください。"
    htmlFor="field-assets"
    label="総資産（万円）"
    required
  >
    <InputControl defaultValue="12億" id="field-assets" invalid />
  </Field>
);

export const WithTextarea = () => (
  <Field description="試合後の振り返りなど、自由に記録できます。" htmlFor="field-memo" label="メモ">
    <TextareaControl
      defaultValue="終盤のキングボンビーで順位が大きく入れ替わった。"
      id="field-memo"
      minHeight="sm"
    />
  </Field>
);
