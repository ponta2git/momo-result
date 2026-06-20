import { motion } from "motion/react";
import { useCallback, useId, useMemo } from "react";
import type { ChangeEvent } from "react";

import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { momoSpring } from "@/shared/ui/motion/variants";

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
  options: SegmentedOption[];
  value: string;
};

export function SegmentedControl({
  asSelect = false,
  className,
  disabled = false,
  label = "選択",
  onValueChange,
  options,
  value,
}: SegmentedControlProps) {
  const id = useId();
  const selectOptions = useMemo(
    () =>
      options.map((option) => ({
        disabled: disabled || option.disabled,
        label: option.label,
        value: option.value,
      })),
    [disabled, options],
  );
  const handleSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onValueChange(event.currentTarget.value);
    },
    [onValueChange],
  );

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
            indicatorId={`${id}-indicator`}
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

function SegmentedButton({
  disabled,
  indicatorId,
  option,
  selected,
  onValueChange,
}: {
  disabled: boolean | undefined;
  indicatorId: string;
  option: SegmentedOption;
  selected: boolean;
  onValueChange: (value: string) => void;
}) {
  const handleClick = useCallback(() => {
    onValueChange(option.value);
  }, [onValueChange, option.value]);

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "relative isolate min-h-9 min-w-[5ch] overflow-hidden rounded-[var(--radius-xs)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors duration-150",
        selected ? "text-[var(--color-text-primary)]" : "",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      disabled={disabled}
      type="button"
      onClick={handleClick}
    >
      {selected ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 z-0 rounded-[var(--radius-xs)] bg-[var(--color-surface-selected)]"
          layoutId={indicatorId}
          transition={momoSpring}
        />
      ) : null}
      <span className="relative z-[var(--z-base)]">{option.label}</span>
    </button>
  );
}
