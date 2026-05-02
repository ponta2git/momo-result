import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
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
    <ToggleGroup
      aria-label={label}
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-stretch gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1",
        className,
      )}
      value={[value]}
      onValueChange={(nextValue) => {
        const selectedValue = nextValue[0];
        if (selectedValue !== undefined) {
          onValueChange(selectedValue);
        }
      }}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          className={cn(
            "min-h-9 min-w-[5ch] rounded-[var(--radius-xs)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors duration-150",
            "data-[pressed]:bg-[var(--color-surface-selected)] data-[pressed]:text-[var(--color-text-primary)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={option.disabled}
          value={option.value}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
