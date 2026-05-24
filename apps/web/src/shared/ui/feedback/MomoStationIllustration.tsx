import type { SVGProps } from "react";

import { cn } from "@/shared/ui/cn";

type MomoStationIllustrationProps = SVGProps<SVGSVGElement> & {
  tone?: "empty" | "ready";
};

export function MomoStationIllustration({
  className,
  tone = "empty",
  ...props
}: MomoStationIllustrationProps) {
  const accentColor = tone === "ready" ? "var(--color-success)" : "var(--color-action)";

  return (
    <svg
      aria-hidden="true"
      className={cn("h-auto w-full max-w-44 shrink-0", className)}
      data-illustration="momo-station"
      fill="none"
      focusable="false"
      viewBox="0 0 180 132"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M28 102h124"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M40 91h92l14 11H27l13-11Z"
        data-station-part="platform"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M37 52h106l-7 12H44l-7-12Z"
        data-station-part="station-canopy"
        fill="var(--color-warning)"
        opacity="0.36"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M54 36h72a8 8 0 0 1 8 8v47H46V44a8 8 0 0 1 8-8Z"
        data-station-part="station-building"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M56 52h68v20H56V52Z"
        data-station-part="station-sign-board"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      <circle
        cx="90"
        cy="44"
        data-station-part="station-clock"
        fill="var(--color-surface)"
        r="8"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M90 40v4l4 2"
        stroke="var(--color-text-secondary)"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M64 62h16M100 62h16"
        data-station-part="route-mark"
        stroke="var(--color-text-muted)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M86 58h8v8h-8v-8Z"
        fill={accentColor}
        opacity="0.72"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M65 91V76h50v15"
        data-station-part="ticket-gate"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M90 76v15" stroke="var(--color-border-strong)" strokeWidth="2" />
      <path
        d="M73 85h9M98 85h9"
        stroke="var(--color-action)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="54" cy="91" fill="var(--color-action)" opacity="0.18" r="7" />
      <circle cx="126" cy="91" fill="var(--color-action)" opacity="0.18" r="7" />
      <path
        d="M47 36 60 21h61l13 15H47Z"
        data-station-part="station-roof"
        fill="var(--color-warning)"
        opacity="0.38"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M39 108c10 8 91 8 102 0"
        data-station-part="rail"
        stroke="var(--color-action)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M58 116h64"
        data-station-part="rail"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="37" cy="28" fill="var(--color-warning)" opacity="0.5" r="6" />
      <circle cx="146" cy="64" fill="var(--color-success)" opacity="0.22" r="5" />
    </svg>
  );
}
