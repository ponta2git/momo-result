import { useId } from "react";

import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";

type SegmentedOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type SegmentedControlProps = {
  asSelect?: boolean;
  className?: string;
  label?: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  value: string;
};

export function SegmentedControl({
  asSelect = false,
  className,
  label = "選択",
  onValueChange,
  options,
  value,
}: SegmentedControlProps) {
  const id = useId();

  if (asSelect) {
    return (
      <SelectField
        id={id}
        label={label}
        options={options.map((option) => ({
          disabled: option.disabled,
          label: option.label,
          value: option.value,
        }))}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <div
      aria-label={label}
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-stretch gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1",
        className,
      )}
      role="group"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            aria-pressed={selected}
            className={cn(
              "min-h-9 min-w-[5ch] rounded-[var(--radius-xs)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors duration-150",
              selected ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]" : "",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            disabled={option.disabled}
            type="button"
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
