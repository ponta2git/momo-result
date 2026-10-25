import { CircleHelp } from "lucide-react";
import { IconButton, Tooltip, TooltipProvider } from "momo-result-ui";

export const Group = () => (
  <TooltipProvider>
    <div className="flex items-center gap-4 text-sm">
      {[
        ["総資産", "物件と現金の合計です。"],
        ["収益", "1年間の物件収益の合計です。"],
        ["目的地", "目的地に一番乗りした回数です。"],
      ].map(([label, description]) => (
        <span className="flex items-center gap-1" key={label}>
          {label}
          <Tooltip content={description}>
            <IconButton
              aria-label={`${label}の説明`}
              icon={<CircleHelp aria-hidden="true" />}
              size="sm"
              variant="quiet"
            />
          </Tooltip>
        </span>
      ))}
    </div>
  </TooltipProvider>
);
