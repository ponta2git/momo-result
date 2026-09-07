import type { ReactNode } from "react";

/**
 * Keeps related reading content independent of action height. The action group
 * follows the content when their combined widths no longer fit the parent slot.
 */
export function ContentWithActions({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-[1_1_16rem]">{children}</div>
      {actions ? (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
