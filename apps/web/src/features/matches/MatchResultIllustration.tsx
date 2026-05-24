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
        d="M19 109h130"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M28 84h34v25H28V84Z"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M63 66h42v43H63V66Z"
        fill="var(--color-warning)"
        opacity="0.26"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M106 91h34v18h-34V91Z"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path d="M73 66h22v-8H73v8Z" fill="var(--color-warning)" opacity="0.75" />
      <path
        d="M79 58v-8h10v8"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M67 31h34l-5 19H72l-5-19Z"
        fill="var(--color-success)"
        opacity="0.82"
        stroke="var(--color-border-strong)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M67 34h-9c-1 9 3 16 12 17M101 34h9c1 9-3 16-12 17"
        stroke="var(--color-border-strong)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M84 37 87 44h7l-6 4 2 7-6-4-6 4 2-7-6-4h7l3-7Z"
        fill="var(--color-warning)"
        stroke="var(--color-border-strong)"
        strokeWidth="2"
      />
      <path
        d="M84 16v8M58 22l5 7M111 22l-5 7"
        stroke="var(--color-warning)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="42" cy="34" fill="var(--color-action)" opacity="0.5" r="4" />
      <circle cx="126" cy="43" fill="var(--color-success)" opacity="0.36" r="5" />
      <circle cx="134" cy="70" fill="var(--color-warning)" opacity="0.55" r="3.5" />
      <path
        d="M23 57h9M136 28h10M22 119c14 7 110 7 124 0"
        stroke="var(--color-action)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <text
        fill="var(--color-warning)"
        fontSize="26"
        fontWeight="700"
        textAnchor="middle"
        x="84"
        y="97"
      >
        1
      </text>
      <text
        fill="var(--color-text-secondary)"
        fontSize="18"
        fontWeight="700"
        textAnchor="middle"
        x="45"
        y="103"
      >
        2
      </text>
      <text
        fill="var(--color-text-secondary)"
        fontSize="16"
        fontWeight="700"
        textAnchor="middle"
        x="123"
        y="105"
      >
        3
      </text>
    </svg>
  );
}
