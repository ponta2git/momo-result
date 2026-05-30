import type { MatchListAction } from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

type MatchListActionsProps = {
  disabled?: boolean;
  checkingDraftIds?: ReadonlySet<string> | undefined;
  onDraftStatusCheckAction?: ((action: MatchListAction) => void) | undefined;
  primaryAction: MatchListAction;
  secondaryActions: MatchListAction[];
};

function ActionButton({
  action,
  checkingDraftIds,
  disabled = false,
  onDraftStatusCheckAction,
}: {
  action: MatchListAction;
  checkingDraftIds?: ReadonlySet<string> | undefined;
  disabled?: boolean;
  onDraftStatusCheckAction?: ((action: MatchListAction) => void) | undefined;
}) {
  const variant = action.variant ?? "primary";
  const isChecking = action.draftStatusCheck
    ? (checkingDraftIds?.has(action.draftStatusCheck.draftId) ?? false)
    : false;

  if (
    action.href &&
    action.draftStatusCheck &&
    !action.disabled &&
    !disabled &&
    onDraftStatusCheckAction
  ) {
    return (
      <Button
        className="w-full justify-center"
        pending={isChecking}
        pendingLabel="確認中…"
        size="sm"
        variant={variant}
        onClick={() => onDraftStatusCheckAction?.(action)}
      >
        {action.label}
      </Button>
    );
  }

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
  checkingDraftIds,
  disabled = false,
  onDraftStatusCheckAction,
  primaryAction,
  secondaryActions,
}: MatchListActionsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionButton
        action={primaryAction}
        checkingDraftIds={checkingDraftIds}
        disabled={disabled}
        onDraftStatusCheckAction={onDraftStatusCheckAction}
      />
      {secondaryActions.map((action) => (
        <ActionButton
          key={`${action.label}:${action.href ?? "disabled"}`}
          action={action}
          checkingDraftIds={checkingDraftIds}
          disabled={disabled}
          onDraftStatusCheckAction={onDraftStatusCheckAction}
        />
      ))}
    </div>
  );
}
