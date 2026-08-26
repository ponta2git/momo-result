import { useId } from "react";
import type { ChangeEvent } from "react";

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
  disabled?: boolean | undefined;
  label?: string;
  onValueChange: (value: string) => void;
  optionClassName?: string;
  options: SegmentedOption[];
  value: string;
};

export function SegmentedControl({
  asSelect = false,
  className,
  disabled = false,
  label = "選択",
  onValueChange,
  optionClassName,
  options,
  value,
}: SegmentedControlProps) {
  const id = useId();
  const selectOptions = options.map((option) => ({
    disabled: disabled || option.disabled,
    label: option.label,
    value: option.value,
  }));
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onValueChange(event.currentTarget.value);
  };

  if (asSelect) {
    return (
      <SelectField
        id={id}
        label={label}
        options={selectOptions}
        disabled={disabled}
        value={value}
        onChange={handleSelectChange}
      />
    );
  }

  return (
    <fieldset
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-stretch gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        return (
          <SegmentedButton
            key={option.value}
            option={option}
            className={optionClassName}
            disabled={disabled || option.disabled}
            selected={option.value === value}
            onValueChange={onValueChange}
          />
        );
      })}
    </fieldset>
  );
}

function SegmentedButton({
  className,
  disabled,
  option,
  selected,
  onValueChange,
}: {
  className?: string | undefined;
  disabled: boolean | undefined;
  option: SegmentedOption;
  selected: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "min-h-11 min-w-[5ch] rounded-[var(--radius-xs)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] sm:min-h-9 sm:py-1",
        selected
          ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
          : "hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      disabled={disabled}
      type="button"
      onClick={() => onValueChange(option.value)}
    >
      {option.label}
    </button>
  );
}
