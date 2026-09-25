import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useHref, useLinkClickHandler } from "react-router-dom";

import { buttonClassName, DecorativeActionIcon } from "@/shared/ui/actions/actionRecipes";
import { cn } from "@/shared/ui/cn";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";
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
  alignment?: "center" | "outward";
  disabled?: boolean | undefined;
  status?: ReactNode;
};

// Available destinations and known ends keep the same text, spacing, and alignment.
const destinationClassName =
  "grid min-h-11 min-w-0 grid-cols-1 content-start justify-items-center gap-1 border border-transparent px-5 py-3 text-center text-base font-plain whitespace-normal break-words text-[var(--color-text-secondary)]";

/** Keeps each direction and its destination together, including known ends and temporary pauses. */
export function AdjacentNavigation({
  label,
  previous,
  next,
  alignment = "center",
  disabled = false,
  status,
}: AdjacentNavigationProps) {
  return (
    <nav aria-label={label} className="grid min-w-0 gap-2">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Destination
          destination={previous}
          direction="previous"
          alignment={alignment}
          disabled={disabled}
        />
        <Destination
          destination={next}
          direction="next"
          alignment={alignment}
          disabled={disabled}
        />
      </div>
      {status ? <div className={contentText.supporting}>{status}</div> : null}
    </nav>
  );
}

function Destination({
  destination,
  direction,
  alignment,
  disabled,
}: {
  destination: AdjacentDestination;
  direction: "previous" | "next";
  alignment: "center" | "outward";
  disabled: boolean;
}) {
  const icon = direction === "previous" ? <ArrowLeft /> : <ArrowRight />;
  const className = cn(
    destinationClassName,
    alignment === "outward" &&
      (direction === "previous"
        ? "sm:justify-items-start sm:text-left"
        : "sm:justify-items-end sm:text-right"),
  );
  const content = (
    <>
      <span className="inline-flex items-center gap-2">
        <DecorativeActionIcon>{icon}</DecorativeActionIcon>
        <span>{destination.label}</span>
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
    <AdjacentLink className={className} disabled={disabled} to={destination.href}>
      {content}
    </AdjacentLink>
  );
}

/** A paused destination retains its DOM/focus but has no href that could open stale data. */
function AdjacentLink({
  children,
  className,
  disabled,
  to,
}: {
  children: ReactNode;
  className: string;
  disabled: boolean;
  to: string;
}) {
  const href = useHref(to);
  const handleClick = useLinkClickHandler(to, { state: adjacentNavigationState });
  const surfaceRef = useSurfaceFeedback<HTMLAnchorElement>();
  return (
    <a
      ref={surfaceRef}
      aria-disabled={disabled || undefined}
      className={cn(buttonClassName({ disabled, size: "lg", variant: "quiet" }), className)}
      href={disabled ? undefined : href}
      role={disabled ? "link" : undefined}
      tabIndex={disabled ? 0 : undefined}
      onClick={(event) => {
        if (disabled) event.preventDefault();
        else handleClick(event);
      }}
    >
      {children}
    </a>
  );
}
