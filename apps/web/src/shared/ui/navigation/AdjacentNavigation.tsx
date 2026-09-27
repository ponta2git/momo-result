import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ActionLink } from "@/shared/ui/actions/ActionLink";
import { buttonClassName, DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export const adjacentNavigationState = { adjacentNavigation: true } as const;

export type AdjacentDestination = {
  label: string;
  description: string;
  href?: string | undefined;
};

type AdjacentNavigationProps = {
  label: string;
  previous: AdjacentDestination;
  next: AdjacentDestination;
  disabled?: boolean | undefined;
  status?: ReactNode;
};

// Available destinations and known ends keep the same text, spacing, and alignment.
const destinationClassName =
  "row-span-2 grid min-h-11 min-w-0 grid-cols-1 grid-rows-subgrid items-start gap-1 border border-transparent px-5 py-3 text-base font-plain whitespace-normal break-words text-[var(--color-text-secondary)]";

/** Keeps each direction and its destination together, including known ends and temporary pauses. */
export function AdjacentNavigation({
  label,
  previous,
  next,
  disabled = false,
  status,
}: AdjacentNavigationProps) {
  return (
    <nav aria-label={label} className="grid min-w-0 gap-2">
      <div className="grid min-w-0 grid-flow-col grid-cols-2 grid-rows-[auto_auto] gap-x-3 gap-y-1">
        <Destination destination={previous} direction="previous" disabled={disabled} />
        <Destination destination={next} direction="next" disabled={disabled} />
      </div>
      {status ? <div className={contentText.supporting}>{status}</div> : null}
    </nav>
  );
}

function Destination({
  destination,
  direction,
  disabled,
}: {
  destination: AdjacentDestination;
  direction: "previous" | "next";
  disabled: boolean;
}) {
  const icon = direction === "previous" ? <ArrowLeft /> : <ArrowRight />;
  const className = cn(
    destinationClassName,
    direction === "previous" ? "justify-items-start text-start" : "justify-items-end text-end",
  );
  const content = (
    <>
      <span className="inline-flex max-w-full min-w-0 items-center gap-2">
        {direction === "previous" ? <DecorativeActionIcon>{icon}</DecorativeActionIcon> : null}
        <span className="min-w-0">{destination.label}</span>
        {direction === "next" ? <DecorativeActionIcon>{icon}</DecorativeActionIcon> : null}
      </span>
      <span className={cn(contentText.supporting, "block text-pretty tabular-nums")}>
        {destination.description}
      </span>
    </>
  );

  if (!destination.href) {
    return <div className={className}>{content}</div>;
  }
  return (
    <ActionLink
      className={cn(buttonClassName({ disabled, size: "lg", variant: "quiet" }), className)}
      disabled={disabled}
      state={adjacentNavigationState}
      // A paused destination stays reachable without exposing a stale href.
      tabIndex={disabled ? 0 : undefined}
      to={destination.href}
    >
      {content}
    </ActionLink>
  );
}
