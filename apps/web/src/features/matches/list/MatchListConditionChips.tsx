import { X } from "lucide-react";

import type {
  MatchListAppliedCondition,
  MatchListConditionKey,
} from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";

type MatchListConditionChipsProps = {
  conditions: MatchListAppliedCondition[];
  disabled?: boolean | undefined;
  onRemove: (condition: MatchListConditionKey) => void;
};

/** Each applied condition is one removable chip, so the current scope reads in one line. */
export function MatchListConditionChips({
  conditions,
  disabled = false,
  onRemove,
}: MatchListConditionChipsProps) {
  if (conditions.length === 0) return null;
  return (
    <ul aria-label="適用中の条件" className="flex min-w-0 flex-wrap gap-1.5">
      {conditions.map((condition) => (
        <li key={condition.key} className="min-w-0">
          <Button
            aria-label={`${condition.label} を解除`}
            disabled={disabled}
            size="sm"
            variant="secondary"
            onClick={() => onRemove(condition.key)}
          >
            <span className="inline-flex min-w-0 items-center gap-1 text-xs">
              <span className="min-w-0">{condition.label}</span>
              <X aria-hidden="true" className="size-3.5 shrink-0" />
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
