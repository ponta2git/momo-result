import { useId } from "react";

import { cn } from "@/shared/ui/cn";
import { controlBorderClass } from "@/shared/ui/forms/controlPresentation";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

type SegmentedOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type SegmentedControlProps = {
  disabled?: boolean | undefined;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly SegmentedOption[];
  value: string;
};

export function SegmentedControl({
  disabled = false,
  label,
  onValueChange,
  options,
  value,
}: SegmentedControlProps) {
  const name = useId();

  return (
    <fieldset
      disabled={disabled}
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-stretch gap-1 rounded-sm border bg-[var(--color-surface)] p-1",
        controlBorderClass.default,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        return (
          <SegmentedChoice
            key={option.value}
            name={name}
            option={option}
            disabled={disabled || option.disabled}
            selected={option.value === value}
            onValueChange={onValueChange}
          />
        );
      })}
    </fieldset>
  );
}

function SegmentedChoice({
  disabled,
  name,
  option,
  selected,
  onValueChange,
}: {
  disabled: boolean | undefined;
  name: string;
  option: SegmentedOption;
  selected: boolean;
  onValueChange: (value: string) => void;
}) {
  const surfaceRef = useSurfaceFeedback<HTMLLabelElement>();
  return (
    <label
      ref={surfaceRef}
      className={cn(
        "momo-surface momo-surface-press inline-flex min-h-11 min-w-[5ch] items-center justify-center rounded-xs px-3 py-2 text-sm font-plain text-[var(--color-text-secondary)] has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-[var(--color-action)] pointer-fine:min-h-9 pointer-fine:py-1 forced-colors:has-[:checked]:outline forced-colors:has-[:checked]:-outline-offset-2",
        selected ? "momo-surface-selected text-[var(--color-text-primary)]" : "",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <input
        checked={selected}
        className="sr-only focus-visible:outline-none"
        disabled={disabled}
        name={name}
        type="radio"
        value={option.value}
        onChange={() => onValueChange(option.value)}
      />
      {option.label}
    </label>
  );
}
