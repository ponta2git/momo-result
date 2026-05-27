import type { MatchListAction } from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

type MatchListActionsProps = {
  disabled?: boolean;
  primaryAction: MatchListAction;
  secondaryActions: MatchListAction[];
};

function ActionButton({
  action,
  disabled = false,
}: {
  action: MatchListAction;
  disabled?: boolean;
}) {
  const variant = action.variant ?? "primary";

  if (action.href && !action.disabled && !disabled) {
    return (
      <LinkButton className="w-full justify-center" size="sm" to={action.href} variant={variant}>
        {action.label}
      </LinkButton>
    );
  }

  return (
    <Button
      className="w-full justify-center"
      disabled={action.disabled || disabled}
      size="sm"
      variant={variant}
    >
      {action.label}
    </Button>
  );
}

export function MatchListActions({
  disabled = false,
  primaryAction,
  secondaryActions,
}: MatchListActionsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionButton action={primaryAction} disabled={disabled} />
      {secondaryActions.map((action) => (
        <ActionButton
          key={`${action.label}:${action.href ?? "disabled"}`}
          action={action}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
