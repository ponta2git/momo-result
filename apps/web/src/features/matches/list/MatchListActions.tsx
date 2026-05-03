import { Link } from "react-router-dom";

import type { MatchListAction } from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";

type MatchListActionsProps = {
  primaryAction: MatchListAction;
  secondaryActions: MatchListAction[];
};

function ActionButton({ action }: { action: MatchListAction }) {
  const variant = action.variant ?? "primary";

  if (action.href && !action.disabled) {
    return (
      <Link to={action.href}>
        <Button className="w-full justify-center" size="sm" variant={variant}>
          {action.label}
        </Button>
      </Link>
    );
  }

  return (
    <Button
      className="w-full justify-center"
      disabled={action.disabled}
      size="sm"
      variant={variant}
    >
      {action.label}
    </Button>
  );
}

export function MatchListActions({ primaryAction, secondaryActions }: MatchListActionsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionButton action={primaryAction} />
      {secondaryActions.map((action) => (
        <ActionButton key={`${action.label}:${action.href ?? "disabled"}`} action={action} />
      ))}
    </div>
  );
}
