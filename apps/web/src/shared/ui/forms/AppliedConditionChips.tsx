import { X } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";

export type AppliedCondition<Key extends string> = {
  key: Key;
  label: string;
};

type AppliedConditionChipsProps<Key extends string> = {
  conditions: ReadonlyArray<AppliedCondition<Key>>;
  disabled?: boolean | undefined;
  onRemove: (condition: Key) => void;
};

/** Each applied condition is one removable chip, so the current scope reads in one line. */
export function AppliedConditionChips<Key extends string>({
  conditions,
  disabled = false,
  onRemove,
}: AppliedConditionChipsProps<Key>) {
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
