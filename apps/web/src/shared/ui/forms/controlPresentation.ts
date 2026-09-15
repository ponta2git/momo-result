import { cn } from "@/shared/ui/cn";

export type ControlDensity = "compact" | "default";
export type ControlHeight = "default" | "touch";
export type ControlTextAlign = "center" | "end" | "start";
export type ControlTone = "action" | "default" | "review" | "success" | "warning";

export type ControlPresentationProps = {
  controlHeight?: ControlHeight | undefined;
  density?: ControlDensity | undefined;
  invalid?: boolean | undefined;
  textAlign?: ControlTextAlign | undefined;
  tone?: ControlTone | undefined;
};

const densityClass = {
  compact: "px-2",
  default: "px-3",
} as const satisfies Record<ControlDensity, string>;

const heightClass = {
  default: "min-h-11 pointer-fine:min-h-10",
  touch: "min-h-11",
} as const satisfies Record<ControlHeight, string>;

const textAlignClass = {
  center: "text-center",
  end: "text-right",
  start: "text-left",
} as const satisfies Record<ControlTextAlign, string>;

const toneClass = {
  action: "border-[var(--color-control-border-action)] momo-surface-control-action",
  default: "",
  review: "border-[var(--color-control-border-review)] momo-surface-control-review",
  success: "border-[var(--color-control-border-success)] momo-surface-control-success",
  warning: "border-[var(--color-control-border-warning)] momo-surface-control-warning",
} as const satisfies Record<ControlTone, string>;

const baseControlClass =
  "w-full min-w-0 rounded-sm border momo-surface momo-surface-neutral py-2 text-base leading-6 font-plain text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-subtle)] disabled:text-[var(--color-text-muted)] disabled:opacity-70 sm:text-sm sm:leading-5";
// Entry fields need an identifiable boundary; a single-choice select has its own arrow.
const boundaryClass = {
  entry: "border-[var(--color-control-border)]",
  selection: "border-[var(--color-select-border)]",
};
const invalidControlClass =
  "border-[var(--color-control-border-invalid)] momo-surface-control-invalid";

type ResolvedControlPresentation = {
  controlHeight: ControlHeight;
  density: ControlDensity;
  invalid: boolean;
  textAlign: ControlTextAlign;
  tone: ControlTone;
};

export function controlClassName(
  { controlHeight, density, invalid, textAlign, tone }: ResolvedControlPresentation,
  boundary: keyof typeof boundaryClass = "entry",
) {
  return cn(
    baseControlClass,
    heightClass[controlHeight],
    densityClass[density],
    textAlignClass[textAlign],
    invalid ? invalidControlClass : tone === "default" ? boundaryClass[boundary] : toneClass[tone],
  );
}
