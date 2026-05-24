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
  const flagColor = tone === "ready" ? "var(--color-success)" : "var(--color-action)";

  return (
    <svg
      aria-hidden="true"
      className={cn("h-auto w-full max-w-44 shrink-0", className)}
      data-illustration="momo-station"
      fill="none"
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
        d="M50 46h80a8 8 0 0 1 8 8v37H42V54a8 8 0 0 1 8-8Z"
        data-station-part="station-building"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M56 58h68v18H56V58Z"
        data-station-part="station-sign-board"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      <text
        data-station-part="station-sign"
        fill="var(--color-text-primary)"
        fontSize="13"
        fontWeight="700"
        textAnchor="middle"
        x="90"
        y="71"
      >
        駅
      </text>
      <circle
        cx="66"
        cy="67"
        data-station-part="station-clock"
        fill="var(--color-surface)"
        r="6"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M66 64v3l3 2"
        stroke="var(--color-text-secondary)"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path d="M96 66h20" stroke="var(--color-text-muted)" strokeLinecap="round" />
      <path
        d="M65 91V76h50v15"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M90 76v15" stroke="var(--color-border-strong)" strokeWidth="2" />
      <circle cx="54" cy="91" fill="var(--color-action)" opacity="0.18" r="7" />
      <circle cx="126" cy="91" fill="var(--color-action)" opacity="0.18" r="7" />
      <path
        d="M132 40V22"
        stroke="var(--color-text-secondary)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M132 24h25l-5 8 5 8h-25V24Z"
        fill={flagColor}
        opacity="0.9"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M47 46 60 31h61l13 15H47Z"
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
