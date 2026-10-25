import { CircleHelp } from "lucide-react";
import { Button, IconButton, Tooltip } from "momo-result-ui";

export const OnButton = () => (
  <Tooltip content="確定済みの試合だけを集計します。">
    <Button size="sm" variant="secondary">
      順位を再計算
    </Button>
  </Tooltip>
);

export const OnIconButton = () => (
  <div className="flex items-center gap-2 text-sm">
    総資産
    <Tooltip content="物件と現金の合計です。借金は差し引いています。" side="right">
      <IconButton
        aria-label="総資産の説明"
        icon={<CircleHelp aria-hidden="true" />}
        size="sm"
        variant="quiet"
      />
    </Tooltip>
  </div>
);
