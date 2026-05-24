import type { SVGProps } from "react";

import { cn } from "@/shared/ui/cn";

type MatchResultIllustrationProps = SVGProps<SVGSVGElement>;

export function MatchResultIllustration({ className, ...props }: MatchResultIllustrationProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-auto w-full max-w-40 shrink-0", className)}
      fill="none"
      focusable="false"
      viewBox="0 0 168 132"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M20 105h128"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M37 91h94l13 14H24l13-14Z"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M48 53h72a8 8 0 0 1 8 8v30H40V61a8 8 0 0 1 8-8Z"
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M54 64h58v15H54V64Z"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      <path
        d="M84 53V34"
        stroke="var(--color-text-secondary)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M84 36h28l-6 8 6 8H84V36Z"
        fill="var(--color-success)"
        opacity="0.9"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M62 91V78h44v13"
        fill="var(--color-warning)"
        opacity="0.22"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M72 78v13M96 78v13"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M76 78h16l4-13H72l4 13Z"
        fill="var(--color-warning)"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M84 61v8M79 65h10"
        stroke="var(--color-text-primary)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="45" cy="38" fill="var(--color-warning)" opacity="0.65" r="4" />
      <circle cx="128" cy="33" fill="var(--color-action)" opacity="0.5" r="3.5" />
      <circle cx="135" cy="68" fill="var(--color-success)" opacity="0.34" r="5" />
      <path
        d="M31 66h10M122 101c8 5 15 5 22 0M25 113c14 8 104 8 118 0"
        stroke="var(--color-action)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M54 117h60"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}
