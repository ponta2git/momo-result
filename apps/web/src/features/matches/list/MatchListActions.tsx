import type { MatchListAction } from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";

type MatchListActionsProps = {
  disabled?: boolean;
  checkingDraftIds?: ReadonlySet<string> | undefined;
  layout?: "inline" | "stacked";
  onDraftStatusCheckAction?: ((action: MatchListAction) => void) | undefined;
  primaryAction: MatchListAction;
  secondaryActions: MatchListAction[];
};

function ActionButton({
  action,
  checkingDraftIds,
  disabled = false,
  layout,
  onDraftStatusCheckAction,
}: {
  action: MatchListAction;
  checkingDraftIds?: ReadonlySet<string> | undefined;
  disabled?: boolean;
  layout: "inline" | "stacked";
  onDraftStatusCheckAction?: ((action: MatchListAction) => void) | undefined;
}) {
  const variant = action.variant ?? "primary";
  const actionClassName = cn(
    "justify-center",
    layout === "stacked" ? "w-full" : "w-auto max-w-full",
  );
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
        className={actionClassName}
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
      <LinkButton className={actionClassName} size="sm" to={action.href} variant={variant}>
        {action.label}
      </LinkButton>
    );
  }

  return (
    <Button
      className={actionClassName}
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
  layout = "stacked",
  onDraftStatusCheckAction,
  primaryAction,
  secondaryActions,
}: MatchListActionsProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2",
        layout === "stacked" ? "flex-col" : "flex-row flex-wrap items-center",
      )}
    >
      <ActionButton
        action={primaryAction}
        checkingDraftIds={checkingDraftIds}
        disabled={disabled}
        layout={layout}
        onDraftStatusCheckAction={onDraftStatusCheckAction}
      />
      {secondaryActions.map((action) => (
        <ActionButton
          key={`${action.label}:${action.href ?? "disabled"}`}
          action={action}
          checkingDraftIds={checkingDraftIds}
          disabled={disabled}
          layout={layout}
          onDraftStatusCheckAction={onDraftStatusCheckAction}
        />
      ))}
    </div>
  );
}
