import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

/** A stable slot for one operation's status, placed outside the busy content it describes. */
export function PendingStatus({
  children,
  idleLabel,
  pending,
  spinner = true,
}: {
  children: string;
  idleLabel?: string;
  pending: boolean;
  spinner?: boolean;
}) {
  return (
    <span className="grid min-h-8 min-w-0 items-center text-xs text-[var(--color-text-muted)]">
      {idleLabel ? (
        <span
          aria-hidden={pending || undefined}
          className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}
        >
          {idleLabel}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 inline-flex items-center gap-2"
      >
        {spinner ? <span className="size-3.5 shrink-0" /> : null}
        {children}
      </span>
      <span className="col-start-1 row-start-1 inline-flex items-center gap-2" role="status">
        {pending ? (
          <>
            {spinner ? <SpinnerIcon size="sm" /> : null}
            {children}
          </>
        ) : null}
      </span>
    </span>
  );
}
