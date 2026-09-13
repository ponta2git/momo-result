import type { ReactNode } from "react";

import { DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

/** Size the complete states together so an absent normal icon never offsets the label. */
export function PendingActionContent({
  children,
  icon,
  pending,
  pendingLabel,
}: {
  children: ReactNode;
  icon?: ReactNode;
  pending: boolean;
  pendingLabel?: ReactNode;
}) {
  if (pendingLabel == null) {
    if (icon) {
      return (
        <>
          <DecorativeActionIcon>{pending ? <SpinnerIcon /> : icon}</DecorativeActionIcon>
          <span className="min-w-0">{children}</span>
        </>
      );
    }
    return (
      <span className="grid min-w-0 items-center justify-items-center">
        <span className={`col-start-1 row-start-1 ${pending ? "opacity-0" : ""}`}>{children}</span>
        {pending ? (
          <span aria-hidden="true" className="col-start-1 row-start-1">
            <SpinnerIcon />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="grid min-w-0 items-center">
      <span
        aria-hidden={pending || undefined}
        className={`col-start-1 row-start-1 inline-flex min-w-0 items-center justify-center gap-2 ${pending ? "invisible" : ""}`}
      >
        {icon ? <DecorativeActionIcon>{icon}</DecorativeActionIcon> : null}
        <span className="min-w-0">{children}</span>
      </span>
      <span
        aria-hidden={!pending || undefined}
        className={`col-start-1 row-start-1 inline-flex min-w-0 items-center justify-center gap-2 ${pending ? "" : "invisible"}`}
      >
        <DecorativeActionIcon>
          <SpinnerIcon />
        </DecorativeActionIcon>
        <span className="min-w-0">{pendingLabel}</span>
      </span>
    </span>
  );
}
