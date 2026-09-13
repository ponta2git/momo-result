import type { ReactNode } from "react";

import { DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

/** Both labels participate in intrinsic sizing; each supplied subtree mounts only once. */
export function PendingActionContent({
  children,
  icon,
  pending,
  pendingLabel,
  reservePending = true,
}: {
  children: ReactNode;
  icon?: ReactNode;
  pending: boolean;
  pendingLabel?: ReactNode;
  reservePending?: boolean;
}) {
  const changingLabel = pendingLabel != null;
  return (
    <>
      {icon || reservePending ? (
        <DecorativeActionIcon>
          {pending ? <SpinnerIcon /> : (icon ?? <span className="size-4" />)}
        </DecorativeActionIcon>
      ) : null}
      <span className="grid min-w-0 items-center">
        <span
          aria-hidden={pending && changingLabel ? true : undefined}
          className={`col-start-1 row-start-1 ${pending && changingLabel ? "invisible" : ""}`}
        >
          {children}
        </span>
        {changingLabel ? (
          <span
            aria-hidden={!pending || undefined}
            className={`col-start-1 row-start-1 ${pending ? "" : "invisible"}`}
          >
            {pendingLabel}
          </span>
        ) : null}
      </span>
    </>
  );
}
