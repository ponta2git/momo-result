import type { SVGProps } from "react";

import { cn } from "@/shared/ui/cn";

type MomoTransitIllustrationProps = SVGProps<SVGSVGElement> & {
  tone?: "empty" | "ready";
};

export function MomoTransitIllustration({
  className,
  tone = "empty",
  ...props
}: MomoTransitIllustrationProps) {
  const accentColor = tone === "ready" ? "var(--color-success)" : "var(--color-action)";

  return (
    <svg
      aria-hidden="true"
      className={cn("h-auto w-full max-w-44 shrink-0", className)}
      data-illustration="momo-transit"
      fill="none"
      focusable="false"
      viewBox="0 0 180 116"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M24 91h130M36 103h104"
        data-transit-part="rail"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M48 91 36 103M72 91l-9 12M96 91l-5 12M120 91l-2 12M144 91l3 12"
        data-transit-part="rail-sleeper"
        stroke="var(--color-action)"
        strokeLinecap="round"
        strokeWidth="2"
      />

      <path
        d="M24 30h56a6 6 0 0 1 6 6v31a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V55a8 8 0 0 0 0-14v-5a6 6 0 0 1 6-6Z"
        data-transit-part="ticket"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle
        cx="31"
        cy="52"
        data-transit-part="ticket-hole"
        fill="var(--color-surface-subtle)"
        r="5"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      <path
        d="M46 45h26M46 58h18"
        data-transit-part="ticket-line"
        stroke="var(--color-text-muted)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M71 35h8M71 68h8"
        stroke="var(--color-border)"
        strokeLinecap="round"
        strokeWidth="2"
      />

      <path
        d="M77 43c2-13 12-21 30-21h18c17 0 29 11 31 28l3 27H74l3-34Z"
        data-transit-part="train"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M91 42c2-7 8-11 18-11h13c10 0 17 5 20 15l1 7H90l1-11Z"
        data-transit-part="train-window"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M111 31v22M126 33v20"
        stroke="var(--color-border)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path d="M93 67h49" stroke={accentColor} strokeLinecap="round" strokeWidth="4" />
      <circle
        cx="94"
        cy="75"
        data-transit-part="train-light"
        fill="var(--color-warning)"
        opacity="0.75"
        r="5"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <circle
        cx="141"
        cy="75"
        data-transit-part="train-light"
        fill="var(--color-warning)"
        opacity="0.75"
        r="5"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M98 84h11M127 84h11"
        data-transit-part="train-wheel"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <circle cx="160" cy="27" fill="var(--color-success)" opacity="0.22" r="5" />
      <circle cx="37" cy="19" fill="var(--color-warning)" opacity="0.5" r="5" />
    </svg>
  );
}
