import { TextareaControl } from "momo-result-ui";

export const Default = () => (
  <TextareaControl
    aria-label="試合メモ"
    defaultValue="終盤のキングボンビーで順位が大きく入れ替わった。次回は北海道の物件を早めに押さえたい。"
    minHeight="sm"
  />
);

export const Placeholder = () => (
  <TextareaControl
    aria-label="開催の説明"
    minHeight="md"
    placeholder="開催の趣旨やルールの補足を入力"
    placeholderTone="muted"
    resize="vertical"
    textFlow="relaxed"
  />
);

export const States = () => (
  <div className="grid gap-3">
    <TextareaControl
      aria-label="取り消し理由"
      defaultValue=""
      invalid
      minHeight="sm"
      placeholder="理由を入力してください"
    />
    <TextareaControl
      aria-label="確定済みのメモ"
      defaultValue="第11回 桃鉄リーグの結果は確定済みです。"
      disabled
      minHeight="sm"
    />
  </div>
);
